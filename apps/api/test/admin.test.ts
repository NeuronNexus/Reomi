import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAuditLog, profiles } from '../src/db/schema';
import { createHarness } from './helpers';
import type { Harness, User } from './helpers';

let h: Harness;
let admin: User;

beforeAll(async () => {
  h = await createHarness();
});
beforeEach(async () => {
  await h.reset();
  admin = await h.createAdmin();
});
afterAll(() => h.close());

const auditActions = async () =>
  (await h.db.select().from(adminAuditLog)).map((entry) => entry.action);

describe('users', () => {
  it('lists users with host status and supports search', async () => {
    const host = await h.createVerifiedHost(admin);
    await h.createMember('someone');

    const all = await h.call('GET', '/v1/admin/users', admin);
    expect(all.json.total).toBe(3);

    const found = await h.call('GET', `/v1/admin/users?q=${host.email}`, admin);
    expect(found.json.items).toHaveLength(1);
    expect(found.json.items[0].hostStatus).toBe('verified');
  });

  it('filters to recently active users', async () => {
    const dormant = await h.createMember('dormant');
    await h.call('GET', '/v1/me', dormant);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await h.db
      .update(profiles)
      .set({ lastSeenAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(profiles.id, dormant.id));

    const { json } = await h.call('GET', '/v1/admin/users?activeWithinDays=30', admin);
    expect(json.items.map((user: { id: string }) => user.id)).not.toContain(dormant.id);
    expect(json.items.map((user: { id: string }) => user.id)).toContain(admin.id);
  });

  it('paginates', async () => {
    for (let index = 0; index < 3; index += 1) await h.createMember();
    const { json } = await h.call('GET', '/v1/admin/users?pageSize=2&page=2', admin);
    expect(json).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(json.items).toHaveLength(2);
  });

  it('suspends and restores a user, leaving an audit trail', async () => {
    const user = await h.createMember();
    await h.call('PATCH', `/v1/admin/users/${user.id}`, admin, { status: 'suspended' });
    expect((await h.call('GET', '/v1/me', user)).status).toBe(403);
    await h.call('PATCH', `/v1/admin/users/${user.id}`, admin, { status: 'active' });
    expect((await h.call('GET', '/v1/me', user)).status).toBe(200);
    expect(await auditActions()).toEqual(['user.status', 'user.status']);
  });

  it('protects admins from suspension, including themselves', async () => {
    const other = await h.createAdmin();
    const body = { status: 'suspended' };
    expect((await h.call('PATCH', `/v1/admin/users/${admin.id}`, admin, body)).status).toBe(403);
    expect((await h.call('PATCH', `/v1/admin/users/${other.id}`, admin, body)).status).toBe(403);
  });
});

describe('hosts', () => {
  it('queues pending applications first with real identity for review', async () => {
    await h.createVerifiedHost(admin, 'Already Verified');
    const applicant = await h.createMember();
    await h.call('POST', '/v1/host/application', applicant, {
      displayName: 'Waiting Host',
      about: 'I would like to host rooms for people in my city.',
    });

    const { json } = await h.call('GET', '/v1/admin/hosts', admin);
    expect(json.items[0]).toMatchObject({
      displayName: 'Waiting Host',
      status: 'pending',
      email: applicant.email,
    });
    const stats = await h.call('GET', '/v1/admin/stats', admin);
    expect(stats.json.hosts).toEqual({ verified: 1, pending: 1 });
  });
});

describe('rooms', () => {
  it('shows seat usage and host identity', async () => {
    const host = await h.createVerifiedHost(admin, 'Room Owner');
    const room = await h.createOpenRoom(host, 'basic');
    await h.joinRoom(host, room.id);

    const { json } = await h.call('GET', '/v1/admin/rooms', admin);
    expect(json.items[0]).toMatchObject({
      hostDisplayName: 'Room Owner',
      hostEmail: host.email,
      planName: 'Basic',
      seatsTaken: 1,
      live: true,
    });
  });

  it('moves a live room to another plan, granting its limits and features', async () => {
    const host = await h.createVerifiedHost(admin);
    const room = await h.createOpenRoom(host, 'basic');
    const premium = await h.plan('premium');

    const response = await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, {
      planId: premium.id,
    });
    expect(response.status).toBe(204);

    const { json } = await h.call('GET', `/v1/host/rooms/${room.id}`, host);
    expect(json).toMatchObject({ capacity: 100, durationDays: 30, planName: 'Premium' });
    expect(json.entitlements).toContain('analytics_advanced');
    expect(Date.parse(json.endsAt) - Date.parse(json.startsAt)).toBe(30 * 86_400_000);
  });

  it('refuses a plan that cannot hold the people already in the room', async () => {
    const host = await h.createVerifiedHost(admin);
    const room = await h.createOpenRoom(host, 'growth');
    await h.joinRoom(host, room.id);
    await h.joinRoom(host, room.id);
    await h.joinRoom(host, room.id);
    const basic = await h.plan('basic');
    await h.call('PATCH', `/v1/admin/plans/${basic.id}`, admin, { capacity: 2 });

    const response = await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, {
      planId: basic.id,
    });
    expect(response.status).toBe(409);
    expect(response.json.error.code).toBe('capacity_below_seats_taken');
    expect((await h.call('GET', `/v1/host/rooms/${room.id}`, host)).json.capacity).toBe(50);
  });

  it('will not open a room nobody paid for', async () => {
    const host = await h.createVerifiedHost(admin);
    const { id } = await h.plan('basic');
    const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    const response = await h.call('PATCH', `/v1/admin/rooms/${created.json.roomId}`, admin, {
      status: 'open',
    });
    expect(response.status).toBe(409);
  });

  it('can close and reopen a room', async () => {
    const host = await h.createVerifiedHost(admin);
    const room = await h.createOpenRoom(host, 'basic');
    await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, { status: 'closed' });
    expect((await h.call('GET', '/v1/rooms')).json.total).toBe(0);
    await h.call('PATCH', `/v1/admin/rooms/${room.id}`, admin, { status: 'open' });
    expect((await h.call('GET', '/v1/rooms')).json.total).toBe(1);
  });
});

describe('plans and features', () => {
  it('starts with the three plans from the concept document', async () => {
    const { json } = await h.call('GET', '/v1/admin/plans', admin);
    expect(
      json.map((plan: Record<string, unknown>) => [
        plan.name,
        plan.pricePaise,
        plan.durationDays,
        plan.capacity,
      ]),
    ).toEqual([
      ['Basic', 100_000, 7, 20],
      ['Growth', 200_000, 14, 50],
      ['Premium', 400_000, 30, 100],
    ]);
  });

  it('applies edited plan terms to new rooms', async () => {
    const host = await h.createVerifiedHost(admin);
    const { id } = await h.plan('basic');
    await h.call('PATCH', `/v1/admin/plans/${id}`, admin, {
      pricePaise: 150_000,
      capacity: 25,
      platformFeeBps: 2000,
    });

    const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    expect(created.json.checkout.amountPaise).toBe(150_000);
    await h.payMock(host, created.json.checkout);
    const { json } = await h.call('GET', `/v1/rooms/${created.json.roomId}`);
    expect(json.capacity).toBe(25);

    await h.joinRoom(host, created.json.roomId);
    const payments = await h.call('GET', '/v1/admin/payments?purpose=room_ticket', admin);
    expect(payments.json.items[0].platformFeePaise).toBe(6_000);
  });

  it('counts the rooms on each plan', async () => {
    const host = await h.createVerifiedHost(admin);
    await h.createOpenRoom(host, 'basic');
    await h.createOpenRoom(host, 'basic');
    await h.createOpenRoom(host, 'premium');

    const { json } = await h.call('GET', '/v1/admin/plans', admin);
    expect(json.map((plan: { roomCount: number }) => plan.roomCount)).toEqual([2, 0, 1]);
  });

  it('creates a new plan and hides deactivated ones from hosts', async () => {
    const created = await h.call('POST', '/v1/admin/plans', admin, {
      slug: 'festival',
      name: 'Festival',
      description: 'For one big weekend',
      pricePaise: 50_000,
      durationDays: 3,
      capacity: 200,
      platformFeeBps: 500,
      isActive: true,
      sortOrder: 40,
    });
    expect(created.status).toBe(204);
    const festival = await h.plan('festival');
    expect(festival).toBeTruthy();

    await h.call('PATCH', `/v1/admin/plans/${festival.id}`, admin, { isActive: false });
    expect(await h.plan('festival')).toBeUndefined();
  });

  it('rejects a duplicate slug', async () => {
    const { json: existing } = await h.call('GET', '/v1/admin/plans', admin);
    const response = await h.call('PATCH', `/v1/admin/plans/${existing[0].id}`, admin, {
      slug: 'growth',
    });
    expect(response.status).toBe(409);
  });

  it('changes which features a plan grants to new rooms', async () => {
    const host = await h.createVerifiedHost(admin);
    const { id } = await h.plan('basic');
    await h.call('PUT', `/v1/admin/plans/${id}/features`, admin, {
      featureKeys: ['host_dashboard', 'analytics_detailed'],
    });

    const room = await h.createOpenRoom(host, 'basic');
    await h.joinRoom(host, room.id);
    const { json } = await h.call('GET', `/v1/host/rooms/${room.id}`, host);
    expect(json.demand).not.toBeNull();
  });

  it('rejects unknown feature keys and leaves the plan untouched', async () => {
    const before = await h.plan('basic');
    const response = await h.call('PUT', `/v1/admin/plans/${before.id}/features`, admin, {
      featureKeys: ['host_dashboard', 'made_up'],
    });
    expect(response.status).toBe(400);
    expect((await h.plan('basic')).features).toHaveLength(before.features.length);
  });

  it('marks unbuilt features as coming soon rather than selling them as live', async () => {
    const { features } = await h.plan('premium');
    const activity = features.find((f: { key: string }) => f.key === 'activities_advanced');
    expect(activity.isLive).toBe(false);
  });

  it('adds and edits catalogue features', async () => {
    const created = await h.call('POST', '/v1/admin/features', admin, {
      key: 'custom_badge',
      name: 'Custom badge',
      description: 'A badge on your room',
      isLive: false,
      sortOrder: 90,
    });
    expect(created.status).toBe(204);
    await h.call('PATCH', '/v1/admin/features/custom_badge', admin, { isLive: true });
    const { json } = await h.call('GET', '/v1/admin/features', admin);
    expect(json.find((f: { key: string }) => f.key === 'custom_badge').isLive).toBe(true);
  });

  it('audits catalogue changes', async () => {
    const { id } = await h.plan('basic');
    await h.call('PATCH', `/v1/admin/plans/${id}`, admin, { capacity: 30 });
    await h.call('PUT', `/v1/admin/plans/${id}/features`, admin, { featureKeys: [] });
    expect(await auditActions()).toEqual(['plan.update', 'plan.features']);
  });
});

describe('stats', () => {
  it('separates platform revenue from money owed to hosts', async () => {
    const host = await h.createVerifiedHost(admin);
    const room = await h.createOpenRoom(host, 'growth');
    await h.joinRoom(host, room.id);
    await h.joinRoom(host, room.id);

    const { json } = await h.call('GET', '/v1/admin/stats', admin);
    expect(json.revenue).toEqual({
      hostPlanPaise: 200_000,
      ticketGrossPaise: 60_000,
      platformFeePaise: 206_000,
      hostLiabilityPaise: 54_000,
      refundsDuePaise: 0,
    });
    expect(json.rooms).toEqual({ total: 1, live: 1 });
  });

  it('counts a user seen long ago as inactive', async () => {
    const dormant = await h.createMember('dormant');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await h.db.execute(
      sql`update profiles set last_seen_at = now() - interval '60 days' where id = ${dormant.id}`,
    );
    const { json } = await h.call('GET', '/v1/admin/stats', admin);
    expect(json.users).toMatchObject({ total: 2, active30d: 1 });
  });
});
