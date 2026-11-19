import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications, payments, rooms } from '../src/db/schema';
import { settlePayment } from '../src/modules/payments.service';
import { createHarness } from './helpers';
import type { Harness, User } from './helpers';

/**
 * These run against real Postgres with a real connection pool, so requests genuinely overlap.
 * A failure here means a seat was oversold or money was counted twice.
 */

let h: Harness;
let admin: User;
let host: User;

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  admin = await h.createAdmin();
  host = await h.createVerifiedHost(admin);
});
afterAll(() => h.close());

const roomWithCapacity = async (capacity: number) => {
  const { id } = await h.plan('growth');
  await h.call('PATCH', `/v1/admin/plans/${id}`, admin, { capacity });
  return h.createOpenRoom(host, 'growth');
};

const applicants = async (roomId: string, count: number) => {
  const members = await Promise.all(Array.from({ length: count }, () => h.createMember()));
  return Promise.all(
    members.map(async (member) => ({ member, application: await h.apply(member, roomId) })),
  );
};

/**
 * Holds the room row while `contenders` start, so they all pile up on it and then run together.
 * Without this the pool opens connections slowly enough that fast transactions never overlap,
 * and a missing lock goes unnoticed.
 */
const raceBehindRoomLock = async <T>(roomId: string, contenders: () => Promise<T>[]) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let holding = () => {};
  const held = new Promise<void>((resolve) => (holding = resolve));

  const holder = h.db.transaction(async (tx) => {
    await tx.select().from(rooms).where(eq(rooms.id, roomId)).for('update');
    holding();
    await gate;
  });

  await held;
  const results = Promise.all(contenders());
  await new Promise((resolve) => setTimeout(resolve, 400));
  release();
  await holder;
  return results;
};

describe('under concurrent load', () => {
  it('never accepts more people than a room holds', async () => {
    const room = await roomWithCapacity(3);
    const entries = await applicants(room.id, 12);

    const results = await Promise.all(
      entries.map(({ application }) => h.decide(host, room.id, application.id)),
    );

    expect(results.filter((r) => r.status === 204)).toHaveLength(3);
    expect(results.filter((r) => r.json?.error?.code === 'room_full')).toHaveLength(9);
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).json.seatsLeft).toBe(0);
  });

  it('gives every simultaneous applicant a unique alias', async () => {
    const room = await roomWithCapacity(50);
    const entries = await applicants(room.id, 15);
    const aliases = entries.map(({ application }) => application.alias);
    expect(new Set(aliases).size).toBe(15);
  });

  it('records one application when a member double submits', async () => {
    const room = await roomWithCapacity(10);
    const member = await h.createMember();
    const results = await raceBehindRoomLock(room.id, () =>
      Array.from({ length: 6 }, () =>
        h.call('POST', `/v1/rooms/${room.id}/applications`, member, {
          message: 'I would love to join this room please.',
        }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.json?.error?.code === 'already_applied')).toHaveLength(5);
    const rows = await h.db
      .select()
      .from(applications)
      .where(and(eq(applications.roomId, room.id), eq(applications.userId, member.id)));
    expect(rows).toHaveLength(1);
  });

  it('creates a single order when checkout is double clicked', async () => {
    const room = await roomWithCapacity(10);
    const [entry] = await applicants(room.id, 1);
    await h.decide(host, room.id, entry!.application.id);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => h.checkout(entry!.member, entry!.application.id)),
    );

    expect(new Set(results.map((r) => r.json.orderId)).size).toBe(1);
    const rows = await h.db
      .select()
      .from(payments)
      .where(eq(payments.applicationId, entry!.application.id));
    expect(rows).toHaveLength(1);
  });

  it('settles once when the callback and webhook race', async () => {
    const room = await roomWithCapacity(10);
    const [entry] = await applicants(room.id, 1);
    await h.decide(host, room.id, entry!.application.id);
    const order = (await h.checkout(entry!.member, entry!.application.id)).json;

    const settled = await raceBehindRoomLock(room.id, () =>
      Array.from({ length: 10 }, () => settlePayment(h.db, order.paymentId, 'pay_race')),
    );

    expect(settled.every((payment) => payment.status === 'paid')).toBe(true);
    const [row] = await h.db.select().from(payments).where(eq(payments.id, order.paymentId));
    expect(row).toMatchObject({ status: 'paid', platformFeePaise: 3_000 });
    const stats = await h.call('GET', '/v1/admin/stats', admin);
    expect(stats.json.revenue.ticketGrossPaise).toBe(30_000);
  });

  it('does not oversell when late payers race for the last seat', async () => {
    const room = await roomWithCapacity(5);
    const entries = await applicants(room.id, 5);
    for (const { application } of entries) await h.decide(host, room.id, application.id);
    const orders = await Promise.all(
      entries.map(async ({ member, application }) => ({
        member,
        order: (await h.checkout(member, application.id)).json,
      })),
    );

    // Every hold lapses, then a fresh applicant takes four of the five seats.
    await h.db
      .update(applications)
      .set({ paymentDueAt: new Date(Date.now() - 1000) })
      .where(eq(applications.roomId, room.id));
    for (let index = 0; index < 4; index += 1) await h.joinRoom(host, room.id);

    const results = await Promise.all(
      orders.map(({ order }) => settlePayment(h.db, order.paymentId, `pay_${order.orderId}`)),
    );

    expect(results.filter((payment) => payment.status === 'paid')).toHaveLength(1);
    expect(results.filter((payment) => payment.status === 'refund_required')).toHaveLength(4);
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).json.seatsLeft).toBe(0);
  });

  it('activates a room once when its plan payment is settled repeatedly', async () => {
    const { id } = await h.plan('basic');
    const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    const { paymentId } = created.json.checkout;

    await Promise.all(
      Array.from({ length: 6 }, () => settlePayment(h.db, paymentId, 'pay_plan_race')),
    );

    const { json } = await h.call('GET', `/v1/rooms/${created.json.roomId}`);
    expect(json.seatsLeft).toBe(20);
    const [row] = await h.db.select().from(payments).where(eq(payments.id, paymentId));
    expect(row?.status).toBe('paid');
  });
});
