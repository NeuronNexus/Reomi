import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { hashPassword } from './auth-stub';

export const DEMO_PASSWORD = 'password123';

interface DemoUser {
  email: string;
  fullName: string;
  gender: string;
  interestedIn: string[];
  role?: 'admin';
  host?: { name: string; about: string; status: 'verified' | 'pending' };
}

const USERS: DemoUser[] = [
  {
    email: 'admin@demo.test',
    fullName: 'Asha Admin',
    gender: 'woman',
    interestedIn: ['men'],
    role: 'admin',
  },
  {
    email: 'host@demo.test',
    fullName: 'Rohan Mehta',
    gender: 'man',
    interestedIn: ['women'],
    host: {
      name: 'Slow Burn Socials',
      about: 'I have been running small dinner clubs in Bengaluru for six years.',
      status: 'verified',
    },
  },
  {
    email: 'host2@demo.test',
    fullName: 'Meera Iyer',
    gender: 'woman',
    interestedIn: ['men', 'women'],
    host: {
      name: 'The Long Table',
      about: 'A former radio host who loves getting strangers talking honestly.',
      status: 'verified',
    },
  },
  {
    email: 'pending@demo.test',
    fullName: 'Kabir Shah',
    gender: 'man',
    interestedIn: ['women'],
    host: {
      name: 'Midnight Quiz Club',
      about: 'I run a popular pub quiz and would like to bring it online for singles.',
      status: 'pending',
    },
  },
  { email: 'member@demo.test', fullName: 'Ananya Rao', gender: 'woman', interestedIn: ['men'] },
];

const ROOMS = [
  {
    host: 'host@demo.test',
    plan: 'premium',
    title: 'Two truths and a slow dance',
    summary: 'Honest questions, no photos, and a playlist everyone adds to',
    category: 'dating',
    ticket: 50_000,
  },
  {
    host: 'host2@demo.test',
    plan: 'growth',
    title: 'The bookshop after closing',
    summary: 'For people who still fold the corner of the page',
    category: 'hobbies',
    ticket: 30_000,
  },
  {
    host: 'host@demo.test',
    plan: 'growth',
    title: 'Sunday chai and strangers',
    summary: 'A gentle room to make new friends in your city',
    category: 'friends',
    ticket: 15_000,
  },
  {
    host: 'host2@demo.test',
    plan: 'basic',
    title: 'What your playlist says about you',
    summary: 'Guess the person behind the songs before anyone reveals a thing',
    category: 'personality',
    ticket: 20_000,
  },
  {
    host: 'host@demo.test',
    plan: 'basic',
    title: 'Six people, one long dinner',
    summary: 'A small table for those tired of small talk',
    category: 'small_group',
    ticket: 45_000,
  },
  {
    host: 'host2@demo.test',
    plan: 'premium',
    title: 'Letters to someone you have not met',
    summary: 'Write first, wonder later. Hosted by a former radio host',
    category: 'dating',
    ticket: 60_000,
  },
];

const DESCRIPTION =
  'Everyone arrives under an alias chosen for this room alone. We begin with one good question ' +
  'each evening and let the conversation decide the rest. Nobody sees a name or a face unless ' +
  'two people both choose to reveal themselves.';

/** Adds sample people and rooms once, so a fresh checkout has something to look at. */
export const loadDemoData = async (sql: ReturnType<typeof postgres>) => {
  const [{ exists } = { exists: false }] = await sql<{ exists: boolean }[]>`
    select exists(select 1 from auth.users where email = 'admin@demo.test') as exists`;
  if (exists) return;

  const ids = new Map<string, string>();
  for (const user of USERS) {
    const id = randomUUID();
    ids.set(user.email, id);
    await sql`insert into auth.users (id, email, password)
      values (${id}, ${user.email}, ${hashPassword(DEMO_PASSWORD)})`;
    await sql`insert into profiles
        (id, email, full_name, date_of_birth, gender, interested_in, role, last_seen_at)
      values (${id}, ${user.email}, ${user.fullName}, '1994-03-12', ${user.gender},
        ${user.interestedIn}, ${user.role ?? 'user'}, now())`;
    if (user.host) {
      await sql`insert into host_verifications (user_id, display_name, about, status)
        values (${id}, ${user.host.name}, ${user.host.about}, ${user.host.status})`;
    }
  }

  for (const room of ROOMS) {
    const [plan] = await sql<
      {
        id: string;
        price_paise: number;
        capacity: number;
        duration_days: number;
        platform_fee_bps: number;
      }[]
    >`select * from plans where slug = ${room.plan}`;
    const links = await sql<{ feature_key: string }[]>`
      select feature_key from plan_features where plan_id = ${plan!.id}`;
    const hostId = ids.get(room.host)!;
    const roomId = randomUUID();
    await sql`insert into rooms (id, host_id, plan_id, title, summary, description, category,
        ticket_price_paise, plan_price_paise, capacity, duration_days, platform_fee_bps,
        entitlements, status, starts_at, ends_at)
      values (${roomId}, ${hostId}, ${plan!.id}, ${room.title}, ${room.summary}, ${DESCRIPTION},
        ${room.category}, ${room.ticket}, ${plan!.price_paise}, ${plan!.capacity},
        ${plan!.duration_days}, ${plan!.platform_fee_bps},
        ${links.map((link) => link.feature_key)}, 'open', now(),
        now() + make_interval(days => ${plan!.duration_days}))`;
    await sql`insert into payments (user_id, room_id, purpose, status, provider,
        provider_order_id, provider_payment_id, amount_paise, platform_fee_paise, paid_at)
      values (${hostId}, ${roomId}, 'host_plan', 'paid', 'mock', ${`demo_order_${roomId}`},
        ${`demo_pay_${roomId}`}, ${plan!.price_paise}, ${plan!.price_paise}, now())`;
  }
};
