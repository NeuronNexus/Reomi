import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { CURRENCY } from '@agnipath/shared';
import type { Checkout, PaymentResult } from '@agnipath/shared';
import type { Db, Tx } from '../db/client';
import { applications, payments, rooms } from '../db/schema';
import { AppError, conflict, notFound } from '../lib/errors';
import type { PaymentProvider } from '../lib/payment-provider';
import { isRoomLive, seatsTakenSql, viewStatus } from './common';

type Payment = typeof payments.$inferSelect;
type Room = typeof rooms.$inferSelect;

interface Deps {
  db: Db;
  provider: PaymentProvider;
}

const toCheckout = (
  payment: Payment,
  provider: PaymentProvider,
  description: string,
): Checkout => ({
  paymentId: payment.id,
  provider: provider.name,
  publicKey: provider.publicKey,
  orderId: payment.providerOrderId,
  amountPaise: payment.amountPaise,
  currency: payment.currency,
  description,
});

/**
 * Returns the open order for this purchase or creates one. The partial unique indexes on
 * `payments` make this safe when two requests arrive together: the loser's insert is ignored
 * and it picks up the winner's row, so a person never has two payable orders for one seat.
 */
const openOrder = async (
  { db, provider }: Deps,
  input: {
    userId: string;
    roomId: string;
    applicationId: string | null;
    purpose: Payment['purpose'];
    amountPaise: number;
  },
): Promise<Payment> => {
  const findOpen = async () =>
    (
      await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.status, 'created'),
            eq(payments.purpose, input.purpose),
            input.applicationId
              ? eq(payments.applicationId, input.applicationId)
              : eq(payments.roomId, input.roomId),
          ),
        )
    )[0];

  const existing = await findOpen();
  if (existing) return existing;

  const id = randomUUID();
  const { orderId } = await provider.createOrder({
    amountPaise: input.amountPaise,
    currency: CURRENCY,
    receipt: id,
  });

  const [inserted] = await db
    .insert(payments)
    .values({
      ...input,
      id,
      provider: provider.name,
      providerOrderId: orderId,
      currency: CURRENCY,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const winner = await findOpen();
  if (!winner) throw conflict('conflict', 'Could not start checkout, please try again');
  return winner;
};

export const openPlanCheckout = async (deps: Deps, room: Room): Promise<Checkout> => {
  if (room.status !== 'pending_payment') {
    throw conflict('room_not_open', 'This room has already been paid for');
  }
  const payment = await openOrder(deps, {
    userId: room.hostId,
    roomId: room.id,
    applicationId: null,
    purpose: 'host_plan',
    amountPaise: room.planPricePaise,
  });
  return toCheckout(payment, deps.provider, `Hosting plan for ${room.title}`);
};

export const openTicketCheckout = async (
  deps: Deps,
  applicationId: string,
  userId: string,
): Promise<Checkout> => {
  const [row] = await deps.db
    .select({ application: applications, room: rooms })
    .from(applications)
    .innerJoin(rooms, eq(rooms.id, applications.roomId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)));
  if (!row) throw notFound('Application');

  if (viewStatus(row.application) !== 'accepted') {
    throw conflict('application_not_payable', 'This application is not awaiting payment');
  }
  if (!isRoomLive(row.room)) throw conflict('room_not_open', 'This room is no longer open');

  const payment = await openOrder(deps, {
    userId,
    roomId: row.room.id,
    applicationId,
    purpose: 'room_ticket',
    amountPaise: row.room.ticketPricePaise,
  });
  return toCheckout(payment, deps.provider, `Ticket for ${row.room.title}`);
};

const settleHostPlan = async (tx: Tx, payment: Payment, room: Room, now: Date) => {
  if (room.status !== 'pending_payment') return null;
  await tx
    .update(rooms)
    .set({
      status: 'open',
      startsAt: now,
      endsAt: new Date(now.getTime() + room.durationDays * 86_400_000),
    })
    .where(eq(rooms.id, room.id));
  return { platformFeePaise: payment.amountPaise, hostEarningPaise: 0 };
};

const settleTicket = async (tx: Tx, payment: Payment, room: Room, now: Date) => {
  const [application] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, payment.applicationId!))
    .for('update');
  if (!application || application.status !== 'accepted' || !isRoomLive(room, now)) return null;

  // Paying after the window is fine as long as the released seat has not gone to someone else.
  if (viewStatus(application, now) === 'expired') {
    const [seats] = await tx
      .select({ taken: seatsTakenSql(room.id) })
      .from(rooms)
      .where(eq(rooms.id, room.id));
    if ((seats?.taken ?? 0) >= room.capacity) return null;
  }

  await tx
    .update(applications)
    .set({ status: 'joined', paymentDueAt: null })
    .where(eq(applications.id, application.id));

  const platformFeePaise = Math.round((payment.amountPaise * room.platformFeeBps) / 10_000);
  return { platformFeePaise, hostEarningPaise: payment.amountPaise - platformFeePaise };
};

/**
 * Applies captured money exactly once. The browser callback and the provider webhook both land
 * here and can race, so the payment row lock decides the winner and the loser sees it settled.
 *
 * Money that arrives when it can no longer buy anything (room closed, seat gone) is recorded as
 * `refund_required` rather than dropped, and surfaces in the CMS.
 */
export const settlePayment = async (
  db: Db,
  paymentId: string,
  providerPaymentId: string,
): Promise<Payment> =>
  db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update');
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'created') return payment;

    const [room] = await tx.select().from(rooms).where(eq(rooms.id, payment.roomId)).for('update');
    if (!room) throw notFound('Room');

    const now = new Date();
    const split =
      payment.purpose === 'host_plan'
        ? await settleHostPlan(tx, payment, room, now)
        : await settleTicket(tx, payment, room, now);

    const [settled] = await tx
      .update(payments)
      .set({
        status: split ? 'paid' : 'refund_required',
        providerPaymentId,
        paidAt: now,
        platformFeePaise: split?.platformFeePaise ?? 0,
        hostEarningPaise: split?.hostEarningPaise ?? 0,
      })
      .where(eq(payments.id, payment.id))
      .returning();
    return settled!;
  });

const toResult = (payment: Payment, processing = false): PaymentResult => ({
  paymentId: payment.id,
  status: payment.status,
  roomId: payment.roomId,
  processing,
});

export const confirmPayment = async (
  { db, provider }: Deps,
  input: { paymentId: string; userId: string; providerPaymentId: string; signature: string },
): Promise<PaymentResult> => {
  const [payment] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, input.paymentId), eq(payments.userId, input.userId)));
  if (!payment) throw notFound('Payment');
  if (payment.status !== 'created') return toResult(payment);

  const validSignature = provider.verifyCheckoutSignature({
    orderId: payment.providerOrderId,
    paymentId: input.providerPaymentId,
    signature: input.signature,
  });
  if (!validSignature) throw new AppError(400, 'payment_invalid', 'Payment could not be verified');

  // A valid signature only proves the payment was authorised, so ask the provider what happened.
  const remote = await provider.fetchPayment(input.providerPaymentId);
  if (remote.orderId !== payment.providerOrderId || remote.amountPaise !== payment.amountPaise) {
    throw new AppError(400, 'payment_invalid', 'Payment does not match this order');
  }
  if (remote.status !== 'captured') return toResult(payment, true);

  return toResult(await settlePayment(db, payment.id, input.providerPaymentId));
};

interface RazorpayEvent {
  event: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
  };
}

/** Returns normally for anything unactionable, so the provider does not retry it forever. */
export const handleProviderEvent = async (
  { db, provider }: Deps,
  event: RazorpayEvent,
  log: { warn: (data: object, message: string) => void },
): Promise<void> => {
  if (event.event !== 'payment.captured' && event.event !== 'order.paid') return;

  const entity = event.payload?.payment?.entity;
  if (!entity?.id || !entity.order_id) return;

  const [payment] = await db
    .select()
    .from(payments)
    .where(
      and(eq(payments.provider, provider.name), eq(payments.providerOrderId, entity.order_id)),
    );
  if (!payment) {
    log.warn({ orderId: entity.order_id }, 'Webhook for an unknown order');
    return;
  }
  if (entity.amount !== payment.amountPaise) {
    log.warn({ paymentId: payment.id, amount: entity.amount }, 'Webhook amount mismatch');
    return;
  }
  await settlePayment(db, payment.id, entity.id);
};
