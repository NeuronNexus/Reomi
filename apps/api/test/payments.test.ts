import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { applications, payments } from '../src/db/schema';
import { RazorpayProvider } from '../src/lib/payment-provider';
import { createHarness } from './helpers';
import type { Harness, User } from './helpers';

const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'whsec_test';

/** Stands in for api.razorpay.com so the real provider code runs end to end. */
const remotePayments = new Map<string, { status: string; order_id: string; amount: number }>();
let orderCounter = 0;
const razorpay = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => (body += chunk));
  request.on('end', () => {
    response.setHeader('content-type', 'application/json');
    if (request.method === 'POST' && request.url === '/orders') {
      orderCounter += 1;
      response.end(JSON.stringify({ id: `order_${orderCounter}`, ...JSON.parse(body) }));
      return;
    }
    const payment = remotePayments.get(request.url?.replace('/payments/', '') ?? '');
    response.statusCode = payment ? 200 : 404;
    response.end(JSON.stringify(payment ?? { error: 'not found' }));
  });
});

let h: Harness;
let admin: User;
let host: User;

beforeAll(async () => {
  await new Promise<void>((resolve) => razorpay.listen(0, '127.0.0.1', resolve));
  const { port } = razorpay.address() as AddressInfo;
  h = await createHarness(
    new RazorpayProvider('rzp_test_key', KEY_SECRET, WEBHOOK_SECRET, `http://127.0.0.1:${port}`),
  );
});
beforeEach(async () => {
  await h.reset();
  remotePayments.clear();
  admin = await h.createAdmin();
  host = await h.createVerifiedHost(admin);
});
afterAll(async () => {
  await h.close();
  razorpay.close();
});

const checkoutSignature = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

/** Simulates a customer completing Razorpay checkout, then the browser callback. */
const pay = async (
  user: User,
  order: { paymentId: string; orderId: string; amountPaise: number },
  status = 'captured',
) => {
  const providerPaymentId = `pay_${order.orderId}`;
  remotePayments.set(providerPaymentId, {
    status,
    order_id: order.orderId,
    amount: order.amountPaise,
  });
  return h.call('POST', `/v1/payments/${order.paymentId}/confirm`, user, {
    providerPaymentId,
    signature: checkoutSignature(order.orderId, providerPaymentId),
  });
};

const webhook = (payload: object, secret = WEBHOOK_SECRET) => {
  const body = JSON.stringify(payload);
  return h.app.inject({
    method: 'POST',
    url: '/webhooks/razorpay',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex'),
    },
    payload: body,
  });
};

const captured = (order: { orderId: string; amountPaise: number }, event = 'payment.captured') => ({
  event,
  payload: {
    payment: {
      entity: {
        id: `pay_${order.orderId}`,
        order_id: order.orderId,
        amount: order.amountPaise,
        status: 'captured',
      },
    },
  },
});

const openRoom = async (slug = 'growth') => {
  const { id } = await h.plan(slug);
  const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
  await pay(host, created.json.checkout);
  return { id: created.json.roomId as string };
};

const acceptedMember = async (roomId: string) => {
  const member = await h.createMember();
  const application = await h.apply(member, roomId);
  await h.decide(host, roomId, application.id);
  const order = (await h.checkout(member, application.id)).json;
  return { member, application, order };
};

const paymentRow = async (id: string) =>
  (await h.db.select().from(payments).where(eq(payments.id, id)))[0]!;

const applicationRow = async (id: string) =>
  (await h.db.select().from(applications).where(eq(applications.id, id)))[0]!;

describe('checkout confirmation', () => {
  it('opens a room once its plan payment is captured', async () => {
    const room = await openRoom();
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).status).toBe(200);
  });

  it('records the ticket split using the commission on the room', async () => {
    const room = await openRoom();
    const { member, order } = await acceptedMember(room.id);
    await pay(member, order);
    expect(await paymentRow(order.paymentId)).toMatchObject({
      status: 'paid',
      amountPaise: 20_000,
      platformFeePaise: 2_000,
      hostEarningPaise: 18_000,
    });
  });

  it('rejects a forged signature and grants nothing', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);
    const response = await h.call('POST', `/v1/payments/${order.paymentId}/confirm`, member, {
      providerPaymentId: 'pay_fake',
      signature: 'a'.repeat(64),
    });
    expect(response.status).toBe(400);
    expect(response.json.error.code).toBe('payment_invalid');
    expect((await applicationRow(application.id)).status).toBe('accepted');
  });

  it('rejects a genuine payment from a different, cheaper order', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);
    remotePayments.set('pay_cheap', { status: 'captured', order_id: 'order_other', amount: 100 });
    const response = await h.call('POST', `/v1/payments/${order.paymentId}/confirm`, member, {
      providerPaymentId: 'pay_cheap',
      signature: checkoutSignature(order.orderId, 'pay_cheap'),
    });
    expect(response.status).toBe(400);
    expect((await applicationRow(application.id)).status).toBe('accepted');
  });

  it("does not let one member confirm another member's payment", async () => {
    const room = await openRoom();
    const { order } = await acceptedMember(room.id);
    const stranger = await h.createMember();
    expect((await pay(stranger, order)).status).toBe(404);
  });

  it('does not grant a seat for money that is only authorised', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);

    const response = await pay(member, order, 'authorized');
    expect(response.json).toMatchObject({ status: 'created', processing: true });
    expect((await applicationRow(application.id)).status).toBe('accepted');

    await webhook(captured(order));
    expect((await applicationRow(application.id)).status).toBe('joined');
  });

  it('returns the settled result when confirmed twice', async () => {
    const room = await openRoom();
    const { member, order } = await acceptedMember(room.id);
    expect((await pay(member, order)).json.status).toBe('paid');
    expect((await pay(member, order)).json.status).toBe('paid');
  });
});

describe('webhooks', () => {
  it('rejects a bad signature', async () => {
    const room = await openRoom();
    const { application, order } = await acceptedMember(room.id);
    expect((await webhook(captured(order), 'wrong-secret')).statusCode).toBe(400);
    expect((await applicationRow(application.id)).status).toBe('accepted');
  });

  it('rejects a missing signature', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/webhooks/razorpay',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(response.statusCode).toBe(400);
  });

  it('settles a payment when the customer closed the tab before the callback', async () => {
    const room = await openRoom();
    const { application, order } = await acceptedMember(room.id);
    expect((await webhook(captured(order))).statusCode).toBe(200);
    expect((await applicationRow(application.id)).status).toBe('joined');
    expect((await paymentRow(order.paymentId)).providerPaymentId).toBe(`pay_${order.orderId}`);
  });

  it('is unaffected by retries and by both event types arriving', async () => {
    const room = await openRoom();
    const { order } = await acceptedMember(room.id);
    await webhook(captured(order));
    await webhook(captured(order));
    await webhook(captured(order, 'order.paid'));
    const rows = await h.db.select().from(payments).where(eq(payments.id, order.paymentId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'paid', platformFeePaise: 2_000 });
  });

  it('ignores an amount that does not match the order', async () => {
    const room = await openRoom();
    const { application, order } = await acceptedMember(room.id);
    const response = await webhook(captured({ ...order, amountPaise: 1 }));
    expect(response.statusCode).toBe(200);
    expect((await applicationRow(application.id)).status).toBe('accepted');
  });

  it('acknowledges unknown orders and unrelated events without acting', async () => {
    expect((await webhook(captured({ orderId: 'nope', amountPaise: 1 }))).statusCode).toBe(200);
    expect((await webhook({ event: 'refund.created' })).statusCode).toBe(200);
  });
});

describe('money that can no longer buy a seat', () => {
  it('flags a refund when the room closed before the payment landed', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);
    await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, { status: 'closed' });

    expect((await pay(member, order)).json.status).toBe('refund_required');
    expect((await applicationRow(application.id)).status).toBe('accepted');
  });

  it('flags a refund when the member withdrew but paid anyway', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);
    await h.call('DELETE', `/v1/applications/${application.id}`, member);
    expect((await pay(member, order)).json.status).toBe('refund_required');
  });

  it('honours a late payment when the seat is still free', async () => {
    const room = await openRoom();
    const { member, application, order } = await acceptedMember(room.id);
    await h.db
      .update(applications)
      .set({ paymentDueAt: new Date(Date.now() - 1000) })
      .where(eq(applications.id, application.id));

    expect((await pay(member, order)).json.status).toBe('paid');
    expect((await applicationRow(application.id)).status).toBe('joined');
  });

  it('flags a refund for a late payment once the seat went to someone else', async () => {
    const room = await openRoom();
    await h.db.execute(sql`update rooms set capacity = 1 where id = ${room.id}`);
    const { member, application, order } = await acceptedMember(room.id);
    await h.db
      .update(applications)
      .set({ paymentDueAt: new Date(Date.now() - 1000) })
      .where(eq(applications.id, application.id));

    const rival = await acceptedMember(room.id);
    await pay(rival.member, rival.order);

    expect((await pay(member, order)).json.status).toBe('refund_required');
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).json.seatsLeft).toBe(0);
  });

  it('shows the amount due in the CMS, then records the refund once', async () => {
    const room = await openRoom();
    const { member, order } = await acceptedMember(room.id);
    await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, { status: 'closed' });
    await pay(member, order);

    const stats = await h.call('GET', '/v1/admin/stats', admin);
    expect(stats.json.revenue.refundsDuePaise).toBe(20_000);
    expect(stats.json.revenue.ticketGrossPaise).toBe(0);

    const url = `/v1/admin/payments/${order.paymentId}/mark-refunded`;
    expect((await h.call('POST', url, admin)).status).toBe(204);
    expect((await h.call('POST', url, admin)).status).toBe(409);
    const after = await h.call('GET', '/v1/admin/stats', admin);
    expect(after.json.revenue.refundsDuePaise).toBe(0);
  });
});

describe('configuration', () => {
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://localhost/x',
    SUPABASE_URL: 'https://x.supabase.co',
    CORS_ORIGINS: 'https://app.example.com',
  };

  it('refuses to boot production with the mock provider', () => {
    expect(() => loadConfig({ ...production, PAYMENT_PROVIDER: 'mock' })).toThrow(/mock/i);
  });

  it('refuses to boot without Razorpay secrets', () => {
    expect(() => loadConfig({ ...production, PAYMENT_PROVIDER: 'razorpay' })).toThrow(
      /RAZORPAY_KEY_SECRET/,
    );
  });
});
