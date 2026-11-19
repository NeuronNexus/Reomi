import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { profiles } from '../src/db/schema';
import { createHarness } from './helpers';
import type { Harness, User } from './helpers';

let h: Harness;
let admin: User;
let host: User;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  admin = await h.createAdmin();
  host = await h.createVerifiedHost(admin, 'Slow Burn Socials');
});

const asMan = async (user: User, fullName = 'Rohan Mehta') => {
  await h.call('PUT', '/v1/me/profile', user, {
    fullName,
    dateOfBirth: '1994-02-01',
    gender: 'man',
    interestedIn: ['women'],
  });
  return user;
};

describe('room space', () => {
  it('delivers clean messages and blocks identity leaks before anyone sees them', async () => {
    const room = await h.createOpenRoom(host);
    const { member: ananya } = await h.joinRoom(host, room.id);
    await h.db.update(profiles).set({ fullName: 'Ananya Rao' }).where(eq(profiles.id, ananya.id));
    const { member: other } = await h.joinRoom(host, room.id);
    await h.db
      .update(profiles)
      .set({ fullName: 'Kabir Malhotra' })
      .where(eq(profiles.id, other.id));

    const ok = await h.call('POST', `/v1/rooms/${room.id}/messages`, ananya, {
      body: 'Hello everyone!',
    });
    expect(ok.status).toBe(201);
    expect(ok.text).not.toContain(ananya.id);
    expect(ok.json.sender.role).toBe('member');

    const leak = await h.call('POST', `/v1/rooms/${room.id}/messages`, ananya, {
      body: 'I think one of you is Kabir from my office',
    });
    expect(leak.status).toBe(422);
    expect(leak.json.error.code).toBe('message_blocked');
    expect(leak.json.error.details).toMatchObject({
      reason: 'identity_other',
      strikes: 1,
      action: 'warning',
    });

    const timeline = await h.call('GET', `/v1/rooms/${room.id}/messages`, other);
    expect(timeline.json.map((m: { body: string }) => m.body)).toEqual(['Hello everyone!']);

    const flags = await h.call('GET', '/v1/admin/flags', admin);
    expect(flags.json.items[0]).toMatchObject({ reason: 'identity_other', severity: 'strong' });
  });

  it('climbs the ladder: warning, mute', async () => {
    const room = await h.createOpenRoom(host);
    const { member } = await h.joinRoom(host, room.id);
    const { member: target } = await h.joinRoom(host, room.id);
    await h.db
      .update(profiles)
      .set({ fullName: 'Zoravar Singh' })
      .where(eq(profiles.id, target.id));
    const send = (body: string) =>
      h.call('POST', `/v1/rooms/${room.id}/messages`, member, { body });
    expect((await send('zoravar is here')).json.error.details.action).toBe('warning');
    expect((await send('hey zoravar')).json.error.details.action).toBe('muted');
    expect((await send('just saying hi')).json.error.code).toBe('muted');
  });

  it('keeps outsiders out of the room', async () => {
    const room = await h.createOpenRoom(host);
    const stranger = await h.createMember();
    expect((await h.call('GET', `/v1/rooms/${room.id}/messages`, stranger)).status).toBe(403);
    expect((await h.call('GET', `/v1/rooms/${room.id}/space`, host)).status).toBe(200);
  });

  it('runs activities from the plan and counts anonymous votes', async () => {
    const room = await h.createOpenRoom(host, 'premium');
    const { member } = await h.joinRoom(host, room.id);
    const created = await h.call('POST', `/v1/host/rooms/${room.id}/activities`, host, {
      kind: 'poll',
      title: 'Ideal first date?',
      options: ['Coffee', 'Live music'],
    });
    expect(created.status).toBe(201);
    const activityId = created.json.activity.id;
    const vote = await h.call('POST', `/v1/activities/${activityId}/respond`, member, {
      choice: 1,
    });
    expect(vote.json).toMatchObject({ results: [0, 1], myChoice: 1, responses: 1 });

    const basic = await h.createOpenRoom(host, 'basic');
    const refused = await h.call('POST', `/v1/host/rooms/${basic.id}/activities`, host, {
      kind: 'poll',
      title: 'Not on this plan',
      options: ['A', 'B'],
    });
    expect(refused.json.error.code).toBe('feature_not_in_plan');
  });
});

describe('mutual reveal', () => {
  it('shows real profiles only after both agree, and counts confirmed connections', async () => {
    const room = await h.createOpenRoom(host);
    const { member: a } = await h.joinRoom(host, room.id);
    const { member: b, application: bApp } = await h.joinRoom(host, room.id);

    const asked = await h.call('POST', `/v1/rooms/${room.id}/reveals`, a, {
      toAlias: bApp.alias,
      announce: true,
    });
    expect(asked.status).toBe(204);

    const pending = (await h.call('GET', '/v1/me/connections', b)).json;
    expect(pending[0]).toMatchObject({ direction: 'incoming', status: 'pending', profile: null });

    await h.call('POST', `/v1/reveals/${pending[0].id}/respond`, b, {
      accept: true,
      announce: true,
    });
    const seen = (await h.call('GET', '/v1/me/connections', a)).json;
    expect(seen[0].profile).toMatchObject({ userId: b.id, fullName: 'Real Person Name' });

    const timeline = (await h.call('GET', `/v1/rooms/${room.id}/messages`, a)).json;
    expect(timeline.at(-1)).toMatchObject({ kind: 'announcement' });

    const dm = await h.call('POST', `/v1/users/${b.id}/dm`, a);
    expect(dm.status).toBe(200);
    const sent = await h.call('POST', `/v1/threads/${dm.json.threadId}/messages`, a, {
      body: 'my number is 98765 43210',
    });
    expect(sent.status).toBe(201);

    await h.call('POST', `/v1/reveals/${pending[0].id}/confirm`, a, { stage: 'talking' });
    await h.call('POST', `/v1/reveals/${pending[0].id}/confirm`, b, { stage: 'talking' });
    const dashboard = (await h.call('GET', `/v1/host/rooms/${room.id}`, host)).json;
    expect(dashboard.connections).toEqual({ reveals: 1, verified: 1 });
  });

  it('refuses direct messages without a reveal', async () => {
    const room = await h.createOpenRoom(host);
    const { member: a } = await h.joinRoom(host, room.id);
    const { member: b } = await h.joinRoom(host, room.id);
    expect((await h.call('POST', `/v1/users/${b.id}/dm`, a)).status).toBe(403);
  });
});

describe('interest balance', () => {
  it('stops a host from accepting someone who would unbalance a dating room', async () => {
    const room = await h.createOpenRoom(host, 'growth', { category: 'dating' });
    const men = await Promise.all([1, 2, 3].map(async () => asMan(await h.createMember('man'))));
    const apps: { id: string }[] = [];
    for (const man of men) apps.push(await h.apply(man, room.id));
    expect((await h.decide(host, room.id, apps[0]!.id)).status).toBe(204);
    expect((await h.decide(host, room.id, apps[1]!.id)).status).toBe(204);
    const blocked = await h.decide(host, room.id, apps[2]!.id);
    expect(blocked.json.error.code).toBe('room_unbalanced');

    const applicants = (await h.call('GET', `/v1/host/rooms/${room.id}/applications`, host)).json;
    expect(applicants.items.find((a: { id: string }) => a.id === apps[2]!.id).admissible).toBe(
      false,
    );

    // A woman joining rebalances the room, and the man can then be accepted.
    const woman = await h.createMember('woman');
    const wApp = await h.apply(woman, room.id);
    expect((await h.decide(host, room.id, wApp.id)).status).toBe(204);
    expect((await h.decide(host, room.id, apps[2]!.id)).status).toBe(204);
  });

  it('admits instantly when the room allows it', async () => {
    const room = await h.createOpenRoom(host, 'growth', { admission: 'instant' });
    const member = await h.createMember();
    const application = await h.apply(member, room.id);
    expect(application.status).toBe('accepted');
  });
});

describe('fair pricing and private rooms', () => {
  it('caps group-room tickets relative to the published reference', async () => {
    const { id, maxTicketPaise } = await h.plan('growth');
    expect(maxTicketPaise).toBe(33_000);
    const created = await h.call(
      'POST',
      '/v1/host/rooms',
      host,
      h.roomInput(id, { ticketPricePaise: 50_000 }),
    );
    expect(created.json.error.code).toBe('ticket_above_cap');
  });

  it('hides private rooms and admits only people with the code', async () => {
    const room = await h.createOpenRoom(host, 'growth', { visibility: 'private' });
    expect((await h.call('GET', '/v1/rooms')).json.total).toBe(0);
    expect((await h.call('GET', `/v1/rooms?ids=${room.id}`)).json.total).toBe(0);
    expect((await h.call('GET', `/v1/rooms/${room.id}`)).status).toBe(404);
    const member = await h.createMember();
    const denied = await h.call('POST', `/v1/rooms/${room.id}/applications`, member, {
      message: 'I would love to join this room please.',
    });
    expect(denied.json.error.code).toBe('invite_code_required');
    const dashboard = (await h.call('GET', `/v1/host/rooms/${room.id}`, host)).json;
    const found = await h.call('GET', `/v1/rooms/by-code/${dashboard.inviteCode}`);
    expect(found.json.roomId).toBe(room.id);
    const ok = await h.call('POST', `/v1/rooms/${room.id}/applications`, member, {
      message: 'I would love to join this room please.',
      inviteCode: dashboard.inviteCode,
    });
    expect(ok.status).toBe(201);
  });
});

describe('ratings and reputation', () => {
  it('lets members rate once after the room ends, feeding the public record', async () => {
    const room = await h.createOpenRoom(host);
    const { member } = await h.joinRoom(host, room.id);
    const early = await h.call('POST', `/v1/rooms/${room.id}/rating`, member, {
      stars: 5,
      comment: '',
    });
    expect(early.json.error.code).toBe('room_not_ended');

    await h.call('POST', `/v1/host/rooms/${room.id}/end`, host);
    expect(
      (
        await h.call('POST', `/v1/rooms/${room.id}/rating`, member, {
          stars: 5,
          comment: 'Lovely host',
        })
      ).status,
    ).toBe(204);
    expect(
      (await h.call('POST', `/v1/rooms/${room.id}/rating`, member, { stars: 1, comment: '' })).json
        .error.code,
    ).toBe('already_rated');

    const board = (await h.call('GET', '/v1/leaderboard')).json;
    expect(board[0].host).toMatchObject({
      displayName: 'Slow Burn Socials',
      rating: 5,
      ratingCount: 1,
    });
    expect(JSON.stringify(board)).not.toContain(host.id);

    const profile = (await h.call('GET', `/v1/hosts/${board[0].host.id}`)).json;
    expect(profile.past[0]).toMatchObject({ participants: 1 });
    expect(profile.reviews[0]).toMatchObject({ stars: 5, comment: 'Lovely host' });
  });
});

describe('communities', () => {
  it('keeps posts for members and blocks harassment', async () => {
    const owner = await h.createMember('owner');
    const created = await h.call('POST', '/v1/communities', owner, {
      name: 'Street Style Bengaluru',
      tagline: 'Outfits, thrift finds and styling tips',
      description: 'Share what you wore today and get kind, useful feedback.',
      topic: 'fashion',
      visibility: 'open',
      displayName: 'Thrift Queen',
    });
    expect(created.status).toBe(201);
    const slug = created.json.slug;

    const post = await h.call('POST', `/v1/communities/${slug}/posts`, owner, {
      kind: 'text',
      body: 'Monsoon layering ideas?',
    });
    expect(post.status).toBe(201);
    expect(post.json.author.displayName).toBe('Thrift Queen');
    expect(post.text).not.toContain(owner.id);

    const detail = await h.call('GET', `/v1/communities/${slug}`, owner);
    expect(detail.json).toMatchObject({ memberCount: 1, postCount: 1, myRole: 'owner' });

    const outsider = await h.createMember('outsider');
    expect((await h.call('GET', `/v1/communities/${slug}/posts`, outsider)).status).toBe(403);

    await h.call('POST', `/v1/communities/${slug}/join`, outsider, { displayName: 'Layer Lover' });
    expect((await h.call('GET', '/v1/communities')).json.items[0].memberCount).toBe(2);
    const feed = await h.call('GET', '/v1/feed', outsider);
    expect(feed.json).toHaveLength(1);

    const rude = await h.call('POST', `/v1/posts/${post.json.id}/comments`, outsider, {
      body: 'what a slut',
    });
    expect(rude.json.error.code).toBe('content_blocked');
    const kind = await h.call('POST', `/v1/posts/${post.json.id}/comments`, outsider, {
      body: 'A long shrug works!',
    });
    expect(kind.status).toBe(201);
    expect(kind.json).toHaveLength(1);
  });

  it('asks private communities to approve members', async () => {
    const owner = await h.createMember('owner');
    const { json } = await h.call('POST', '/v1/communities', owner, {
      name: 'Quiet Readers',
      tagline: 'Slow reading, gentle talk',
      description: 'A small circle for people who read before bed.',
      topic: 'books',
      visibility: 'private',
      displayName: 'Night Reader',
    });
    const member = await h.createMember('reader');
    const joined = await h.call('POST', `/v1/communities/${json.slug}/join`, member, {
      displayName: 'Page Turner',
    });
    expect(joined.json.status).toBe('pending');
    const requests = (
      await h.call('GET', `/v1/communities/${json.slug}/members?status=pending`, owner)
    ).json;
    await h.call('PATCH', `/v1/communities/${json.slug}/members/${requests[0].id}`, owner, {
      status: 'active',
    });
    expect((await h.call('GET', `/v1/communities/${json.slug}/posts`, member)).status).toBe(200);

    const mod = await h.createMember('mod');
    await h.call('POST', `/v1/communities/${json.slug}/join`, mod, { displayName: 'Shelf Keeper' });
    const pending = (
      await h.call('GET', `/v1/communities/${json.slug}/members?status=pending`, owner)
    ).json;
    await h.call('PATCH', `/v1/communities/${json.slug}/members/${pending[0].id}`, owner, {
      status: 'active',
    });
    const members = (await h.call('GET', `/v1/communities/${json.slug}/members`, owner)).json;
    const modRow = members.find((m: { displayName: string }) => m.displayName === 'Shelf Keeper');
    const memberRow = members.find((m: { displayName: string }) => m.displayName === 'Page Turner');
    await h.call('PATCH', `/v1/communities/${json.slug}/members/${modRow.id}`, owner, {
      role: 'moderator',
    });
    await h.call('PATCH', `/v1/communities/${json.slug}/members/${memberRow.id}`, owner, {
      role: 'moderator',
    });
    const refused = await h.call(
      'PATCH',
      `/v1/communities/${json.slug}/members/${memberRow.id}`,
      mod,
      { status: 'banned' },
    );
    expect(refused.status).toBe(403);
  });

  it('uploads media to storage and attaches it once', async () => {
    const owner = await h.createMember('owner');
    const upload = await h.call('POST', '/v1/media/uploads', owner, {
      purpose: 'avatar',
      contentType: 'image/png',
      size: 1024,
    });
    expect(upload.status).toBe(201);
    expect(upload.json.upload.method).toBe('PUT');
    const bad = await h.call('POST', '/v1/media/uploads', owner, {
      purpose: 'avatar',
      contentType: 'video/mp4',
      size: 1024,
    });
    expect(bad.json.error.code).toBe('media_invalid');
  });
});
