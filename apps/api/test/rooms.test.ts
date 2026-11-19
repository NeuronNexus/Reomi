import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applications } from '../src/db/schema';
import { createHarness } from './helpers';
import type { Harness, User } from './helpers';

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

describe('becoming a host', () => {
  it('stops unverified users from creating rooms', async () => {
    const user = await h.createMember();
    const { id } = await h.plan('basic');
    const response = await h.call('POST', '/v1/host/rooms', user, h.roomInput(id));
    expect(response.status).toBe(403);
    expect(response.json.error.code).toBe('host_verification_required');
  });

  it('stops a pending host until an admin approves', async () => {
    const user = await h.createMember();
    await h.call('POST', '/v1/host/application', user, {
      displayName: 'Pending Host',
      about: 'I would like to host rooms for people in my city.',
    });
    const { id } = await h.plan('basic');
    expect((await h.call('POST', '/v1/host/rooms', user, h.roomInput(id))).status).toBe(403);

    await h.call('PATCH', `/v1/admin/hosts/${user.id}`, admin, { status: 'verified' });
    expect((await h.call('POST', '/v1/host/rooms', user, h.roomInput(id))).status).toBe(201);
  });

  it('keeps host names unique regardless of case', async () => {
    const [one, two] = [await h.createMember(), await h.createMember()];
    const about = 'I would like to host rooms for people in my city.';
    await h.call('POST', '/v1/host/application', one, { displayName: 'Night Owl', about });
    const response = await h.call('POST', '/v1/host/application', two, {
      displayName: 'night owl',
      about,
    });
    expect(response.status).toBe(409);
    expect(response.json.error.code).toBe('host_name_taken');
  });

  it('lets a rejected host apply again but not a revoked one', async () => {
    const user = await h.createMember();
    const body = {
      displayName: 'Second Try',
      about: 'I would like to host rooms for people in my city.',
    };
    await h.call('POST', '/v1/host/application', user, body);
    await h.call('PATCH', `/v1/admin/hosts/${user.id}`, admin, {
      status: 'rejected',
      reviewNote: 'Tell us more',
    });
    expect((await h.call('GET', '/v1/me', user)).json.host.reviewNote).toBe('Tell us more');
    expect((await h.call('POST', '/v1/host/application', user, body)).status).toBe(204);

    await h.call('PATCH', `/v1/admin/hosts/${user.id}`, admin, { status: 'revoked' });
    expect((await h.call('POST', '/v1/host/application', user, body)).status).toBe(403);
  });
});

describe('creating a room', () => {
  it('keeps the room off Explore until the plan is paid', async () => {
    const { id } = await h.plan('basic');
    const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    expect(created.json.checkout.amountPaise).toBe(100_000);

    expect((await h.call('GET', '/v1/rooms')).json.total).toBe(0);
    expect((await h.call('GET', `/v1/rooms/${created.json.roomId}`)).status).toBe(404);

    await h.payMock(host, created.json.checkout);

    const list = await h.call('GET', '/v1/rooms');
    expect(list.json.total).toBe(1);
    expect(list.json.items[0]).toMatchObject({ capacity: 20, durationDays: 7, seatsLeft: 20 });
  });

  it('sets the room end date from the plan duration', async () => {
    const room = await h.createOpenRoom(host, 'premium');
    const { json } = await h.call('GET', `/v1/rooms/${room.id}`);
    const days = (Date.parse(json.endsAt) - Date.parse(json.startsAt)) / 86_400_000;
    expect(days).toBe(30);
  });

  it('reuses one order when checkout is retried', async () => {
    const { id } = await h.plan('basic');
    const created = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    const retry = await h.call('POST', `/v1/host/rooms/${created.json.roomId}/checkout`, host);
    expect(retry.json.orderId).toBe(created.json.checkout.orderId);
  });

  it('refuses inactive plans', async () => {
    const { id } = await h.plan('basic');
    await h.call('PATCH', `/v1/admin/plans/${id}`, admin, { isActive: false });
    const response = await h.call('POST', '/v1/host/rooms', host, h.roomInput(id));
    expect(response.status).toBe(409);
    expect(response.json.error.code).toBe('plan_unavailable');
  });

  it('does not change existing rooms when a plan is edited later', async () => {
    const room = await h.createOpenRoom(host, 'basic');
    const { id } = await h.plan('basic');
    await h.call('PATCH', `/v1/admin/plans/${id}`, admin, { capacity: 5, durationDays: 1 });
    await h.call('PUT', `/v1/admin/plans/${id}/features`, admin, { featureKeys: [] });

    const { json } = await h.call('GET', `/v1/host/rooms/${room.id}`, host);
    expect(json).toMatchObject({ capacity: 20, durationDays: 7 });
    expect(json.entitlements).toContain('host_dashboard');
  });
});

describe('exploring rooms', () => {
  it('hides rooms that have ended or were closed', async () => {
    const ended = await h.createOpenRoom(host, 'basic', { title: 'Finished room' });
    const closed = await h.createOpenRoom(host, 'basic', { title: 'Closed room' });
    await h.createOpenRoom(host, 'basic', { title: 'Open room' });
    await h.db.execute(
      sql`update rooms set ends_at = now() - interval '1 minute' where id = ${ended.id}`,
    );
    await h.call('PATCH', `/v1/admin/rooms/${closed.id}`, admin, { status: 'closed' });

    const { json } = await h.call('GET', '/v1/rooms');
    expect(json.items.map((room: { title: string }) => room.title)).toEqual(['Open room']);
  });

  it('filters by category and search, treating wildcards literally', async () => {
    await h.createOpenRoom(host, 'basic', { title: 'Chess night', category: 'hobbies' });
    await h.createOpenRoom(host, 'basic', { title: 'Coffee dates', category: 'dating' });

    const hobbies = await h.call('GET', '/v1/rooms?category=hobbies');
    expect(hobbies.json.items).toHaveLength(1);
    expect((await h.call('GET', '/v1/rooms?q=coffee')).json.items).toHaveLength(1);
    expect((await h.call('GET', `/v1/rooms?q=${encodeURIComponent('%')}`)).json.items).toEqual([]);
  });

  it('ranks rooms by the discovery their plan includes', async () => {
    await h.createOpenRoom(host, 'premium', { title: 'Premium room' });
    await h.createOpenRoom(host, 'growth', { title: 'Growth room' });
    await h.createOpenRoom(host, 'basic', { title: 'Basic room' });

    const { json } = await h.call('GET', '/v1/rooms');
    expect(json.items.map((room: { title: string }) => room.title)).toEqual([
      'Premium room',
      'Growth room',
      'Basic room',
    ]);
  });
});

describe('applying', () => {
  it('takes a member from applying to a paid seat', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();

    const application = await h.apply(member, room.id);
    expect(application).toMatchObject({ status: 'pending' });

    // Not payable until the host says yes.
    expect((await h.checkout(member, application.id)).status).toBe(409);

    expect((await h.decide(host, room.id, application.id)).status).toBe(204);
    const accepted = await h.call('GET', `/v1/rooms/${room.id}`, member);
    expect(accepted.json.myApplication.status).toBe('accepted');
    expect(accepted.json.myApplication.paymentDueAt).toBeTruthy();
    expect(accepted.json.seatsLeft).toBe(49);

    const order = await h.checkout(member, application.id);
    expect(order.json.amountPaise).toBe(30_000);
    expect((await h.payMock(member, order.json)).json.status).toBe('paid');

    const lobby = await h.call('GET', `/v1/rooms/${room.id}/lobby`, member);
    expect(lobby.json.yourAlias).toBe(application.alias);
    expect(lobby.json.members).toEqual([{ alias: application.alias }]);
  });

  it('keeps people without a seat out of the lobby', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    await h.apply(member, room.id);
    expect((await h.call('GET', `/v1/rooms/${room.id}/lobby`, member)).status).toBe(403);
    expect((await h.call('GET', `/v1/rooms/${room.id}/lobby`, host)).status).toBe(200);
  });

  it('stops hosts applying to their own room and members applying twice', async () => {
    const room = await h.createOpenRoom(host);
    const body = { message: 'Please let me in to this room.' };
    const own = await h.call('POST', `/v1/rooms/${room.id}/applications`, host, body);
    expect(own.json.error.code).toBe('own_room');

    const member = await h.createMember();
    await h.apply(member, room.id);
    const again = await h.call('POST', `/v1/rooms/${room.id}/applications`, member, body);
    expect(again.json.error.code).toBe('already_applied');
  });

  it('does not let a rejected member apply again', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    const application = await h.apply(member, room.id);
    await h.decide(host, room.id, application.id, 'reject');
    const response = await h.call('POST', `/v1/rooms/${room.id}/applications`, member, {
      message: 'Please reconsider my application.',
    });
    expect(response.json.error.code).toBe('already_applied');
  });

  it('lets a member withdraw and apply again, keeping their alias', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    const first = await h.apply(member, room.id);
    expect((await h.call('DELETE', `/v1/applications/${first.id}`, member)).status).toBe(204);
    const second = await h.apply(member, room.id);
    expect(second).toMatchObject({ id: first.id, alias: first.alias, status: 'pending' });
  });

  it('only lets the owner withdraw an application', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    const application = await h.apply(member, room.id);
    const other = await h.createMember();
    expect((await h.call('DELETE', `/v1/applications/${application.id}`, other)).status).toBe(409);
  });

  it('only lets the room owner decide', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    const application = await h.apply(member, room.id);
    const otherHost = await h.createVerifiedHost(admin);
    expect((await h.decide(otherHost, room.id, application.id)).status).toBe(404);
  });

  it('stops a revoked host from deciding', async () => {
    const room = await h.createOpenRoom(host);
    const member = await h.createMember();
    const application = await h.apply(member, room.id);
    await h.call('PATCH', `/v1/admin/hosts/${host.id}`, admin, { status: 'revoked' });
    const response = await h.decide(host, room.id, application.id);
    expect(response.json.error.code).toBe('host_verification_required');
  });
});

describe('seats', () => {
  const smallRoom = async (capacity: number) => {
    const { id } = await h.plan('growth');
    await h.call('PATCH', `/v1/admin/plans/${id}`, admin, { capacity });
    return h.createOpenRoom(host, 'growth');
  };

  it('refuses to accept beyond capacity', async () => {
    const room = await smallRoom(2);
    const a = await h.apply(await h.createMember(), room.id);
    const b = await h.apply(await h.createMember(), room.id);
    const c = await h.apply(await h.createMember(), room.id);
    expect((await h.decide(host, room.id, a.id)).status).toBe(204);
    expect((await h.decide(host, room.id, b.id)).status).toBe(204);
    const third = await h.decide(host, room.id, c.id);
    expect(third.status).toBe(409);
    expect(third.json.error.code).toBe('room_full');
  });

  it('refuses new applications once a room is full', async () => {
    const room = await smallRoom(2);
    await h.joinRoom(host, room.id);
    await h.joinRoom(host, room.id);
    const late = await h.createMember();
    const response = await h.call('POST', `/v1/rooms/${room.id}/applications`, late, {
      message: 'Please let me in to this room.',
    });
    expect(response.json.error.code).toBe('room_full');
  });

  it('releases a held seat when the payment window lapses', async () => {
    const room = await smallRoom(2);
    const slow = await h.createMember();
    const held = await h.apply(slow, room.id);
    await h.decide(host, room.id, held.id);
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).json.seatsLeft).toBe(1);

    await h.db
      .update(applications)
      .set({ paymentDueAt: new Date(Date.now() - 1000) })
      .where(eq(applications.id, held.id));

    expect((await h.call('GET', `/v1/rooms/${room.id}`)).json.seatsLeft).toBe(2);
    const view = await h.call('GET', '/v1/me/applications', slow);
    expect(view.json[0].status).toBe('expired');
    expect((await h.checkout(slow, held.id)).json.error.code).toBe('application_not_payable');

    // An expired applicant may try again.
    expect((await h.apply(slow, room.id)).status).toBe('pending');
  });

  it('never lets a payment window outlast the room', async () => {
    const room = await h.createOpenRoom(host);
    await h.db.execute(
      sql`update rooms set ends_at = now() + interval '1 hour' where id = ${room.id}`,
    );
    const application = await h.apply(await h.createMember(), room.id);
    await h.decide(host, room.id, application.id);
    const { json } = await h.call('GET', `/v1/host/rooms/${room.id}/applications`, host);
    expect(Date.parse(json.items[0].paymentDueAt)).toBeLessThan(Date.now() + 3_700_000);
  });
});

describe('anonymity', () => {
  it('never shows a host who is behind an alias', async () => {
    const room = await h.createOpenRoom(host, 'premium');
    const member = await h.createUser('secret');
    await h.onboard(member, 'Priyanka Unique Surname');
    const application = await h.apply(member, room.id);
    await h.decide(host, room.id, application.id);
    const order = await h.checkout(member, application.id);
    await h.payMock(member, order.json);

    const surfaces = [
      await h.call('GET', `/v1/host/rooms/${room.id}/applications`, host),
      await h.call('GET', `/v1/host/rooms/${room.id}`, host),
      await h.call('GET', `/v1/rooms/${room.id}/lobby`, host),
      await h.call('GET', `/v1/rooms/${room.id}`, host),
      await h.call('GET', '/v1/rooms'),
    ];

    for (const surface of surfaces) {
      expect(surface.status).toBe(200);
      expect(surface.text).not.toContain(member.email);
      expect(surface.text).not.toContain(member.id);
      expect(surface.text).not.toContain('Priyanka');
      expect(surface.text).not.toContain('1995-06-15');
    }
    expect(surfaces[0]!.text).toContain(application.alias);
  });

  it('never shows a member the identity of other members', async () => {
    const room = await h.createOpenRoom(host);
    const { member: first } = await h.joinRoom(host, room.id, 'first');
    const { member: second } = await h.joinRoom(host, room.id, 'second');

    const lobby = await h.call('GET', `/v1/rooms/${room.id}/lobby`, second);
    expect(lobby.json.members).toHaveLength(2);
    expect(lobby.text).not.toContain(first.email);
    expect(lobby.text).not.toContain(first.id);
  });

  it('does not expose the real identity of a host on public pages', async () => {
    const room = await h.createOpenRoom(host);
    const { text } = await h.call('GET', `/v1/rooms/${room.id}`);
    expect(text).not.toContain(host.email);
    expect(text).not.toContain(host.id);
  });
});

describe('plan entitlements', () => {
  const dashboard = async (slug: string) => {
    const room = await h.createOpenRoom(host, slug);
    await h.joinRoom(host, room.id);
    return (await h.call('GET', `/v1/host/rooms/${room.id}`, host)).json;
  };

  it('Basic gets neither analytics tier', async () => {
    expect(await dashboard('basic')).toMatchObject({ demand: null, funnel: null });
  });

  it('Growth gets demand but not the funnel', async () => {
    const json = await dashboard('growth');
    expect(json.demand.seeking).toEqual([{ interest: 'men', count: 1 }]);
    expect(json.demand.gender).toEqual([{ gender: 'woman', count: 1 }]);
    expect(json.funnel).toBeNull();
  });

  it('Premium gets the funnel with the ticket split', async () => {
    const json = await dashboard('premium');
    expect(json.funnel).toEqual({
      applied: 1,
      accepted: 1,
      joined: 1,
      grossPaise: 30_000,
      platformFeePaise: 3_000,
      hostEarningsPaise: 27_000,
    });
  });
});
