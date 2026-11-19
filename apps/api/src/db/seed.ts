import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { features, planFeatures, plans } from './schema';

const FEATURES = [
  {
    key: 'host_dashboard',
    name: 'Host dashboard',
    description: 'Review applicants and track seats for your room',
    isLive: true,
  },
  {
    key: 'analytics_detailed',
    name: 'Detailed analytics',
    description: 'See who your room attracts and who they want to meet',
    isLive: true,
  },
  {
    key: 'analytics_advanced',
    name: 'Advanced analytics',
    description: 'Application funnel and ticket earnings',
    isLive: true,
  },
  {
    key: 'discovery_enhanced',
    name: 'Enhanced discovery',
    description: 'Listed above standard rooms on Explore',
    isLive: true,
  },
  {
    key: 'discovery_priority',
    name: 'Priority discovery',
    description: 'Listed first on Explore',
    isLive: true,
  },
  {
    key: 'activities_basic',
    name: 'Basic room activities',
    description: 'Conversation prompts and this-or-that questions',
    isLive: true,
  },
  {
    key: 'activities_extended',
    name: 'Extended room activities',
    description: 'Polls with up to six options',
    isLive: true,
  },
  {
    key: 'activities_advanced',
    name: 'Advanced room activities',
    description: 'Structured introduction rounds',
    isLive: true,
  },
];

const PLANS = [
  {
    slug: 'basic',
    name: 'Basic',
    description: 'A short room for a small group',
    pricePaise: 50_000,
    durationDays: 7,
    capacity: 20,
    referenceTicketPaise: 20_000,
    sortOrder: 10,
    featureKeys: ['host_dashboard', 'activities_basic'],
  },
  {
    slug: 'growth',
    name: 'Growth',
    description: 'More people, more time, better insight',
    pricePaise: 200_000,
    durationDays: 14,
    capacity: 50,
    referenceTicketPaise: 30_000,
    sortOrder: 20,
    featureKeys: [
      'host_dashboard',
      'analytics_detailed',
      'discovery_enhanced',
      'activities_basic',
      'activities_extended',
    ],
  },
  {
    slug: 'premium',
    name: 'Premium',
    description: 'The full experience for established hosts',
    pricePaise: 400_000,
    durationDays: 30,
    capacity: 100,
    referenceTicketPaise: 50_000,
    sortOrder: 30,
    featureKeys: [
      'host_dashboard',
      'analytics_detailed',
      'analytics_advanced',
      'discovery_enhanced',
      'discovery_priority',
      'activities_basic',
      'activities_extended',
      'activities_advanced',
    ],
  },
];

/** Placeholder commission until the business model is final. Editable per plan in the CMS. */
const DEFAULT_PLATFORM_FEE_BPS = 1000;

/** Fills an empty catalogue only, so redeploying never overwrites edits made in the CMS. */
export const seedCatalogue = async (db: Db): Promise<boolean> => {
  const existing = await db.select({ id: plans.id }).from(plans).limit(1);
  if (existing.length > 0) return false;

  await db.transaction(async (tx) => {
    await tx
      .insert(features)
      .values(FEATURES.map((feature, index) => ({ ...feature, sortOrder: (index + 1) * 10 })))
      .onConflictDoNothing();

    for (const { featureKeys, ...plan } of PLANS) {
      await tx.insert(plans).values({ ...plan, platformFeeBps: DEFAULT_PLATFORM_FEE_BPS });
      const [row] = await tx.select().from(plans).where(eq(plans.slug, plan.slug));
      await tx
        .insert(planFeatures)
        .values(featureKeys.map((featureKey) => ({ planId: row!.id, featureKey })));
    }
  });
  return true;
};
