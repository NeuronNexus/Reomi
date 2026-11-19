import { deflateSync } from 'node:zlib';
import postgres from 'postgres';

/**
 * Fills a deployed Reomi with demo people, rooms, conversations and communities, going through the
 * real API exactly as the apps do. Accounts use @example.com addresses and one shared password.
 *
 *   API_URL=... SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPABASE_PUBLISHABLE_KEY=...
 *   DATABASE_URL=... DEMO_PASSWORD=... pnpm demo:seed
 *
 * `pnpm demo:reset` wipes every user-created row (keeping plans) and deletes the demo logins.
 * Run it before inviting real people.
 */

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const API = env('API_URL').replace(/\/$/, '');
const SUPABASE = env('SUPABASE_URL').replace(/\/$/, '');
const SECRET = env('SUPABASE_SECRET_KEY');
const PUBLISHABLE = env('SUPABASE_PUBLISHABLE_KEY');
const DATABASE_URL = env('DATABASE_URL');
const PASSWORD = env('DEMO_PASSWORD');
const DOMAIN = 'example.com';

interface Person {
  key: string;
  email: string;
  fullName: string;
  gender: 'woman' | 'man' | 'non_binary';
  wants: string[];
  bio: string;
  city: string;
  token?: string;
  id?: string;
}

const people: Person[] = [
  {
    key: 'admin',
    email: `reomi.admin@${DOMAIN}`,
    fullName: 'Asha Admin',
    gender: 'woman',
    wants: ['men'],
    bio: 'Keeps Reomi kind.',
    city: 'Bengaluru',
  },
  {
    key: 'rohan',
    email: `rohan.host@${DOMAIN}`,
    fullName: 'Rohan Mehta',
    gender: 'man',
    wants: ['women'],
    bio: 'Dinner clubs for six years.',
    city: 'Bengaluru',
  },
  {
    key: 'meera',
    email: `meera.host@${DOMAIN}`,
    fullName: 'Meera Iyer',
    gender: 'woman',
    wants: ['men', 'women'],
    bio: 'Former radio host.',
    city: 'Chennai',
  },
  {
    key: 'kabir',
    email: `kabir.host@${DOMAIN}`,
    fullName: 'Kabir Shah',
    gender: 'man',
    wants: ['women'],
    bio: 'Runs a pub quiz.',
    city: 'Mumbai',
  },
  {
    key: 'ananya',
    email: `ananya@${DOMAIN}`,
    fullName: 'Ananya Rao',
    gender: 'woman',
    wants: ['men'],
    bio: 'Product designer, slow reader, terrible at karaoke.',
    city: 'Bengaluru',
  },
  {
    key: 'ishaan',
    email: `ishaan@${DOMAIN}`,
    fullName: 'Ishaan Kapoor',
    gender: 'man',
    wants: ['women'],
    bio: 'Weekend baker. Will talk about sourdough for hours.',
    city: 'Bengaluru',
  },
  {
    key: 'zoya',
    email: `zoya@${DOMAIN}`,
    fullName: 'Zoya Khan',
    gender: 'woman',
    wants: ['men'],
    bio: 'Thrift queen and street-style photographer.',
    city: 'Pune',
  },
  {
    key: 'arjun',
    email: `arjun@${DOMAIN}`,
    fullName: 'Arjun Nair',
    gender: 'man',
    wants: ['women'],
    bio: 'Marathoner, chai snob.',
    city: 'Kochi',
  },
  {
    key: 'sana',
    email: `sana@${DOMAIN}`,
    fullName: 'Sana Mirza',
    gender: 'woman',
    wants: ['women', 'men'],
    bio: 'Poet by night, analyst by day.',
    city: 'Hyderabad',
  },
  {
    key: 'dev',
    email: `dev@${DOMAIN}`,
    fullName: 'Dev Malhotra',
    gender: 'man',
    wants: ['men'],
    bio: 'Plays bass in two bands.',
    city: 'Delhi',
  },
  {
    key: 'priya',
    email: `priya@${DOMAIN}`,
    fullName: 'Priya Menon',
    gender: 'woman',
    wants: ['men'],
    bio: 'Climber and crossword addict.',
    city: 'Bengaluru',
  },
  {
    key: 'kunal',
    email: `kunal@${DOMAIN}`,
    fullName: 'Kunal Verma',
    gender: 'man',
    wants: ['women'],
    bio: 'Builds tiny robots.',
    city: 'Bengaluru',
  },
];
const by = (key: string) => people.find((p) => p.key === key)!;

/* Plumbing ---------------------------------------------------------------------------------- */

const call = async <T = unknown>(
  method: string,
  path: string,
  who?: Person,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(who?.token ? { authorization: `Bearer ${who.token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
};

const tryCall = async (method: string, path: string, who?: Person, body?: unknown) => {
  try {
    return await call(method, path, who, body);
  } catch (error) {
    console.warn('  (skipped)', (error as Error).message.slice(0, 160));
    return undefined;
  }
};

const ensureLogin = async (person: Person) => {
  const created = await fetch(`${SUPABASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SECRET,
      authorization: `Bearer ${SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email: person.email, password: PASSWORD, email_confirm: true }),
  });
  if (!created.ok && created.status !== 422) {
    throw new Error(`create ${person.email}: ${created.status} ${await created.text()}`);
  }
  const session = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE, 'content-type': 'application/json' },
    body: JSON.stringify({ email: person.email, password: PASSWORD }),
  });
  if (!session.ok)
    throw new Error(`sign in ${person.email}: ${session.status} ${await session.text()}`);
  const json = (await session.json()) as { access_token: string; user: { id: string } };
  person.token = json.access_token;
  person.id = json.user.id;
};

const png = (w: number, h: number, seed: number): Buffer => {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const palettes = [
    [255, 106, 51, 122, 31, 78],
    [255, 197, 107, 58, 28, 113],
    [242, 92, 84, 31, 78, 95],
    [255, 209, 102, 43, 45, 110],
    [127, 209, 161, 32, 48, 110],
  ];
  const [r1, g1, b1, r2, g2, b2] = palettes[seed % palettes.length]!;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w + y / h) / 2;
      const glow = Math.max(0, 1 - Math.hypot(x / w - 0.3, y / h - 0.35) * 1.6);
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = Math.min(255, r1! * (1 - t) + r2! * t + 60 * glow);
      raw[i + 1] = Math.min(255, g1! * (1 - t) + g2! * t + 40 * glow);
      raw[i + 2] = Math.min(255, b1! * (1 - t) + b2! * t + 30 * glow);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const upload = async (who: Person, purpose: 'avatar' | 'post' | 'story', image: Buffer) => {
  const slot = await call<{
    mediaId: string;
    upload: { url: string; headers: Record<string, string> };
  }>('POST', '/v1/media/uploads', who, { purpose, contentType: 'image/png', size: image.length });
  const put = await fetch(slot.upload.url, {
    method: 'PUT',
    headers: slot.upload.headers,
    body: image,
  });
  if (!put.ok) throw new Error(`upload failed: ${put.status} ${await put.text()}`);
  return slot.mediaId;
};

const plans = async () => {
  const list = await call<{ id: string; slug: string }[]>('GET', '/v1/plans');
  return (slug: string) => list.find((plan) => plan.slug === slug)!.id;
};

const openRoom = async (host: Person, input: Record<string, unknown>) => {
  const created = await call<{ roomId: string; checkout: { paymentId: string; orderId: string } }>(
    'POST',
    '/v1/host/rooms',
    host,
    input,
  );
  await call('POST', `/v1/payments/${created.checkout.paymentId}/confirm`, host, {
    providerPaymentId: `mock_pay_${created.checkout.orderId}`,
    signature: 'mock_signature',
  });
  return created.roomId;
};

const join = async (
  host: Person,
  member: Person,
  roomId: string,
  message: string,
  code?: string,
) => {
  const application = await call<{ id: string; alias: string; status: string }>(
    'POST',
    `/v1/rooms/${roomId}/applications`,
    member,
    { message, ...(code ? { inviteCode: code } : {}) },
  );
  if (application.status === 'pending') {
    await call('POST', `/v1/host/rooms/${roomId}/applications/${application.id}/decision`, host, {
      decision: 'accept',
    });
  }
  const order = await call<{ paymentId: string; orderId: string }>(
    'POST',
    `/v1/applications/${application.id}/checkout`,
    member,
  );
  await call('POST', `/v1/payments/${order.paymentId}/confirm`, member, {
    providerPaymentId: `mock_pay_${order.orderId}`,
    signature: 'mock_signature',
  });
  return application.alias;
};

const say = (who: Person, roomId: string, body: string) =>
  tryCall('POST', `/v1/rooms/${roomId}/messages`, who, { body });

/* Reset ------------------------------------------------------------------------------------- */

const reset = async () => {
  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  await sql.unsafe(`truncate notifications, moderation_flags, stories, post_comments, post_likes, posts,
    community_members, communities, media, messages, activity_responses, room_activities, threads,
    reveals, follows, host_ratings, room_waitlist, admin_audit_log, payments, applications, rooms,
    host_verifications, profiles cascade`);
  await sql.end();
  const list = await fetch(`${SUPABASE}/auth/v1/admin/users?per_page=1000`, {
    headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` },
  });
  const { users } = (await list.json()) as { users: { id: string; email: string }[] };
  for (const user of users.filter((u) => u.email?.endsWith(`@${DOMAIN}`))) {
    await fetch(`${SUPABASE}/auth/v1/admin/users/${user.id}`, {
      method: 'DELETE',
      headers: { apikey: SECRET, authorization: `Bearer ${SECRET}` },
    });
  }
  console.log('Reset: app data wiped and demo logins deleted. Plans and features kept.');
};

/* Seed -------------------------------------------------------------------------------------- */

const seed = async () => {
  console.log('Signing in demo people');
  for (const person of people) {
    await ensureLogin(person);
    await call('PUT', '/v1/me/profile', person, {
      fullName: person.fullName,
      dateOfBirth: `199${people.indexOf(person) % 9}-0${(people.indexOf(person) % 8) + 1}-1${people.indexOf(person) % 9}`,
      gender: person.gender,
      interestedIn: person.wants,
    });
  }

  const sql = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
  const [{ count } = { count: 0 }] = await sql<
    { count: number }[]
  >`select count(*)::int as count from rooms`;
  await sql`update profiles set role = 'admin' where id = ${by('admin').id!}`;
  await sql.end();
  if (count > 0) {
    console.log(
      'Rooms already exist, so content was not added again. Run demo:reset first to start over.',
    );
    return;
  }

  console.log('Profiles and photos');
  for (const [index, person] of people.entries()) {
    const avatarMediaId =
      index > 3 ? await upload(person, 'avatar', png(320, 320, index)) : undefined;
    await call('PUT', '/v1/me/details', person, {
      fullName: person.fullName,
      bio: person.bio,
      city: person.city,
      interestedIn: person.wants,
      ...(avatarMediaId ? { avatarMediaId } : {}),
    });
  }

  console.log('Hosts');
  const hosts = [
    {
      who: by('rohan'),
      name: 'Slow Burn Socials',
      about:
        'I have been running small dinner clubs in Bengaluru for six years. My rooms are slow, warm and full of good questions.',
    },
    {
      who: by('meera'),
      name: 'The Long Table',
      about:
        'A former radio host who loves getting strangers talking honestly. Letters, poems and late-night confessions.',
    },
    {
      who: by('kabir'),
      name: 'Midnight Quiz Club',
      about:
        'I run a popular pub quiz and brought it online for singles. Expect chaos, trivia and a lot of laughing.',
    },
  ];
  for (const host of hosts) {
    await call('POST', '/v1/host/application', host.who, {
      displayName: host.name,
      about: host.about,
    });
    await call('PATCH', `/v1/admin/hosts/${host.who.id}`, by('admin'), { status: 'verified' });
  }

  const plan = await plans();
  const description =
    'Everyone arrives under an alias chosen for this room alone. We begin with one good question each evening and let the conversation decide the rest. Nobody sees a name or a face unless two people both choose to reveal themselves.';

  console.log('Rooms');
  const slowDance = await openRoom(by('rohan'), {
    planId: plan('premium'),
    title: 'Two truths and a slow dance',
    summary: 'Honest questions, no photos, and a playlist everyone adds to',
    description,
    category: 'dating',
    ticketPricePaise: 49_900,
  });
  const letters = await openRoom(by('meera'), {
    planId: plan('growth'),
    title: 'Letters to someone you have not met',
    summary: 'Write first, wonder later. Hosted by a former radio host',
    description,
    category: 'dating',
    ticketPricePaise: 29_900,
  });
  const chai = await openRoom(by('rohan'), {
    planId: plan('growth'),
    title: 'Sunday chai and strangers',
    summary: 'A gentle room to make new friends in your city',
    description,
    category: 'friends',
    ticketPricePaise: 14_900,
    admission: 'instant',
    balanceMode: 'open',
  });
  const quiz = await openRoom(by('kabir'), {
    planId: plan('basic'),
    title: 'Midnight quiz for singles',
    summary: 'Teams are random, flirting is optional, trivia is mandatory',
    description,
    category: 'dating',
    ticketPricePaise: 19_900,
  });
  const bookshop = await openRoom(by('meera'), {
    planId: plan('growth'),
    title: 'The bookshop after closing',
    summary: 'For people who still fold the corner of the page',
    description,
    category: 'hobbies',
    ticketPricePaise: 19_900,
    balanceMode: 'open',
  });
  await openRoom(by('kabir'), {
    planId: plan('premium'),
    title: 'Monsoon playlist swap',
    summary: 'Bring three songs that sound like rain. Opens this weekend',
    description,
    category: 'personality',
    ticketPricePaise: 29_900,
    scheduledFor: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  const dinner = await openRoom(by('rohan'), {
    planId: plan('basic'),
    title: 'Six people, one long dinner',
    summary: 'A small private table for those tired of small talk',
    description,
    category: 'small_group',
    ticketPricePaise: 19_900,
    visibility: 'private',
    balanceMode: 'open',
  });

  console.log('Members joining');
  const aliases: Record<string, string> = {};
  for (const [member, note] of [
    ['ananya', 'I want to talk to someone who reads the footnotes.'],
    ['ishaan', 'Looking for someone who laughs at their own jokes.'],
    ['priya', 'Honest questions are my favourite kind.'],
    ['arjun', 'Slow dances and slow mornings, please.'],
    ['zoya', 'Here for good stories and better music.'],
    ['kunal', 'I make playlists for strangers. Seems fitting.'],
  ] as const) {
    aliases[`slow:${member}`] = await join(by('rohan'), by(member), slowDance, note);
  }
  for (const member of ['sana', 'kunal', 'zoya', 'arjun'] as const) {
    aliases[`letters:${member}`] = await join(
      by('meera'),
      by(member),
      letters,
      'I write better than I talk, so this room feels right.',
    );
  }
  for (const member of ['ananya', 'dev', 'priya', 'ishaan', 'sana'] as const) {
    await join(by('rohan'), by(member), chai, 'New-ish in the city and would love company.');
  }
  for (const member of ['priya', 'kunal'] as const) {
    await join(
      by('kabir'),
      by(member),
      quiz,
      'I once won a quiz with a single correct answer about otters.',
    );
  }
  for (const member of ['sana', 'dev', 'ananya'] as const) {
    await join(by('meera'), by(member), bookshop, 'Currently reading three books at once.');
  }
  const dinnerCode = (
    await call<{ inviteCode: string }>('GET', `/v1/host/rooms/${dinner}`, by('rohan'))
  ).inviteCode;
  await join(
    by('rohan'),
    by('arjun'),
    dinner,
    'Rohan gave me the code at the last dinner.',
    dinnerCode,
  );

  console.log('Conversations and activities');
  await say(
    by('rohan'),
    slowDance,
    'Welcome in, everyone. One rule: be more honest than you would be on a first date.',
  );
  await say(
    by('ananya'),
    slowDance,
    'Okay, I will start. I have never finished a single Rubik’s cube and I have bought four.',
  );
  await say(
    by('ishaan'),
    slowDance,
    'That is oddly endearing. Mine: I bake bread when I am anxious, so my freezer is mostly bread.',
  );
  await say(by('priya'), slowDance, 'A freezer full of bread is a love language.');
  await say(
    by('arjun'),
    slowDance,
    'Two truths and a lie: I have run a marathon, I have met a tiger, I have never eaten Maggi.',
  );
  await say(by('zoya'), slowDance, 'The Maggi one is the lie. Nobody grows up here without Maggi.');
  const poll = await call<{ activity: { id: string } }>(
    'POST',
    `/v1/host/rooms/${slowDance}/activities`,
    by('rohan'),
    {
      kind: 'poll',
      title: 'Ideal first date?',
      options: ['Street food walk', 'Bookstore and coffee', 'Live music', 'Cooking together'],
    },
  );
  for (const [member, choice] of [
    ['ananya', 1],
    ['ishaan', 3],
    ['priya', 0],
    ['arjun', 0],
    ['zoya', 2],
    ['kunal', 2],
  ] as const) {
    await tryCall('POST', `/v1/activities/${poll.activity.id}/respond`, by(member), { choice });
  }
  const prompt = await call<{ activity: { id: string } }>(
    'POST',
    `/v1/host/rooms/${slowDance}/activities`,
    by('rohan'),
    {
      kind: 'prompt',
      title: 'What is a small thing that made you smile this week?',
      options: [],
    },
  );
  for (const [member, text] of [
    ['ananya', 'A stranger held the lift and said “no rush” like they meant it.'],
    ['ishaan', 'My sourdough finally rose properly. I took eleven photos.'],
    ['kunal', 'A kid on the metro explaining black holes to his grandmother.'],
  ] as const) {
    await tryCall('POST', `/v1/activities/${prompt.activity.id}/respond`, by(member), { text });
  }
  await say(
    by('meera'),
    letters,
    'Tonight’s prompt: write a two-line letter to the person you will be in five years.',
  );
  await say(
    by('sana'),
    letters,
    'Dear future me: I hope you still say yes to the strange invitations.',
  );
  await say(by('kunal'), letters, 'Dear future me: please water the plants. They trusted you.');
  await say(by('ananya'), chai, 'Is anyone else here for the chai or just the strangers?');
  await say(by('dev'), chai, 'Strangers first, chai a very close second.');

  console.log('A mutual reveal');
  await call('POST', `/v1/rooms/${slowDance}/reveals`, by('ananya'), {
    toAlias: aliases['slow:ishaan'],
    announce: true,
  });
  const incoming = await call<{ id: string; direction: string; status: string }[]>(
    'GET',
    '/v1/me/connections',
    by('ishaan'),
  );
  const request = incoming.find((r) => r.direction === 'incoming' && r.status === 'pending')!;
  await call('POST', `/v1/reveals/${request.id}/respond`, by('ishaan'), {
    accept: true,
    announce: true,
  });
  await call('POST', `/v1/reveals/${request.id}/confirm`, by('ananya'), { stage: 'talking' });
  await call('POST', `/v1/reveals/${request.id}/confirm`, by('ishaan'), { stage: 'talking' });
  const dm = await call<{ threadId: string }>(
    'POST',
    `/v1/users/${by('ishaan').id}/dm`,
    by('ananya'),
  );
  await call('POST', `/v1/threads/${dm.threadId}/messages`, by('ananya'), {
    body: 'So. About that freezer full of bread.',
  });
  await call('POST', `/v1/threads/${dm.threadId}/messages`, by('ishaan'), {
    body: 'Saturday? I will bring a loaf as proof.',
  });

  console.log('A finished room with ratings');
  const poetry = await openRoom(by('meera'), {
    planId: plan('basic'),
    title: 'Poetry swap at golden hour',
    summary: 'Read one poem you love and one you wrote',
    description,
    category: 'personality',
    ticketPricePaise: 14_900,
    balanceMode: 'open',
  });
  const raters = ['sana', 'dev', 'priya', 'arjun'] as const;
  for (const member of raters)
    await join(by('meera'), by(member), poetry, 'I have a poem I have never read aloud.');
  await say(by('meera'), poetry, 'Thank you all for being brave tonight.');
  await call('POST', `/v1/host/rooms/${poetry}/end`, by('meera'));
  const reviews = [
    [5, 'Meera makes everyone feel safe enough to read their worst poems. Magic.'],
    [5, 'The best hour of my week. Gentle, funny and so well run.'],
    [4, 'Lovely room, wish it had run longer.'],
    [5, 'Came for poetry, left with three new friends.'],
  ] as const;
  for (const [index, member] of raters.entries()) {
    await call('POST', `/v1/rooms/${poetry}/rating`, by(member), {
      stars: reviews[index]![0],
      comment: reviews[index]![1],
    });
  }

  console.log('Following hosts');
  const board = await call<{ host: { id: string; displayName: string } }[]>(
    'GET',
    '/v1/leaderboard',
  );
  for (const entry of board) {
    for (const member of ['ananya', 'zoya', 'priya'])
      await tryCall('POST', `/v1/hosts/${entry.host.id}/follow`, by(member));
  }

  console.log('Communities');
  const communitiesToMake = [
    {
      owner: 'zoya',
      name: 'Street Style Bengaluru',
      tagline: 'Outfits, thrift finds and styling tips',
      topic: 'fashion',
      visibility: 'open',
      display: 'Thrift Queen',
      description:
        'Share what you wore today and get kind, useful feedback. Thrift hauls very welcome.',
    },
    {
      owner: 'sana',
      name: 'Night Readers',
      tagline: 'Slow reading and gentle talk before bed',
      topic: 'books',
      visibility: 'private',
      display: 'Page Turner',
      description:
        'A small circle for people who read before sleep. One book a month, no pressure.',
    },
    {
      owner: 'arjun',
      name: 'Weekend Runners',
      tagline: 'Easy runs, early mornings, filter coffee after',
      topic: 'fitness',
      visibility: 'open',
      display: 'Arjun N',
      description: 'All paces welcome. Post your routes, your splits and your post-run breakfasts.',
    },
    {
      owner: 'dev',
      name: 'Indie Music Diggers',
      tagline: 'Find the band before everyone else does',
      topic: 'music',
      visibility: 'open',
      display: 'Bassline Dev',
      description: 'Share the songs you cannot stop playing. Local gigs, demos and deep cuts.',
    },
  ];
  const slugs: Record<string, string> = {};
  for (const c of communitiesToMake) {
    const { slug } = await call<{ slug: string }>('POST', '/v1/communities', by(c.owner), {
      name: c.name,
      tagline: c.tagline,
      description: c.description,
      topic: c.topic,
      visibility: c.visibility,
      displayName: c.display,
      rules:
        'Be kind. Talk about the work, never about bodies. No sharing anyone else’s photos or details.',
    });
    slugs[c.owner] = slug;
  }
  const memberships: [string, string, string][] = [
    ['zoya', 'ananya', 'Ananya R'],
    ['zoya', 'priya', 'Priya climbs'],
    ['zoya', 'sana', 'Sana M'],
    ['arjun', 'ishaan', 'Bread Runner'],
    ['arjun', 'priya', 'Priya climbs'],
    ['arjun', 'kunal', 'Kunal V'],
    ['dev', 'kunal', 'Kunal V'],
    ['dev', 'sana', 'Sana M'],
    ['dev', 'zoya', 'Zoya K'],
  ];
  for (const [owner, member, display] of memberships) {
    await call('POST', `/v1/communities/${slugs[owner]}/join`, by(member), {
      displayName: display,
      useProfilePhoto: true,
    });
  }
  await call('POST', `/v1/communities/${slugs.sana}/join`, by('ananya'), {
    displayName: 'Footnote Fan',
  });

  const posts: [string, string, string, number][] = [
    [
      'zoya',
      'zoya',
      'Thrifted this blazer for ₹350. Styling it three ways this week, look one:',
      2,
    ],
    ['zoya', 'ananya', 'Monsoon-proof and still cute? Trench coat plus wellies, always.', 1],
    ['zoya', 'priya', 'Climbing chalk on everything I own. Is that an aesthetic yet?', 0],
    ['arjun', 'arjun', 'Cubbon Park loop at 6am. 8km, easy pace, coffee at the end.', 1],
    ['arjun', 'ishaan', 'Ran my first 10k and celebrated with, yes, homemade bread.', 0],
    ['dev', 'dev', 'This week’s find: a Shillong band that sounds like rain on a tin roof.', 0],
    ['dev', 'sana', 'Anyone going to the Sunday gig at the old mill?', 0],
  ];
  const postIds: string[] = [];
  for (const [index, [owner, author, body, images]] of posts.entries()) {
    const mediaIds: string[] = [];
    for (let i = 0; i < images; i++)
      mediaIds.push(await upload(by(author), 'post', png(720, 900, index + i)));
    const post = await call<{ id: string }>(
      'POST',
      `/v1/communities/${slugs[owner]}/posts`,
      by(author),
      {
        kind: images ? 'photo' : 'text',
        body,
        mediaIds,
      },
    );
    postIds.push(post.id);
  }
  for (const [postIndex, member, body] of [
    [0, 'ananya', 'Look one is perfect with white sneakers!'],
    [0, 'priya', 'Where do you thrift? Asking for my wardrobe.'],
    [3, 'priya', 'Joining next Saturday, save me a coffee.'],
    [4, 'arjun', 'Bread-powered 10k is the best kind.'],
    [5, 'kunal', 'Added to my rainy-day playlist immediately.'],
  ] as const) {
    await tryCall('POST', `/v1/posts/${postIds[postIndex]}/comments`, by(member), { body });
  }
  for (const [postIndex, member] of [
    [0, 'ananya'],
    [0, 'priya'],
    [0, 'sana'],
    [1, 'zoya'],
    [3, 'ishaan'],
    [4, 'priya'],
    [5, 'zoya'],
  ] as const) {
    await tryCall('POST', `/v1/posts/${postIds[postIndex]}/like`, by(member));
  }
  const storyMedia = await upload(by('zoya'), 'story', png(540, 960, 3));
  await call('POST', `/v1/communities/${slugs.zoya}/stories`, by('zoya'), {
    mediaId: storyMedia,
    caption: 'Today’s thrift haul, full reveal tomorrow',
  });

  console.log('Done.');
};

const mode = process.argv[2] ?? 'seed';
await (mode === 'reset' ? reset() : seed());
