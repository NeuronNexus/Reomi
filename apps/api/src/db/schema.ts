import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  APPLICATION_STATUSES,
  GENDERS,
  HOST_STATUSES,
  PAYMENT_PROVIDERS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  ROOM_CATEGORIES,
  ROOM_STATUSES,
  USER_ROLES,
  USER_STATUSES,
} from '@agnipath/shared';

export const genderEnum = pgEnum('gender', GENDERS);
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const hostStatusEnum = pgEnum('host_status', HOST_STATUSES);
export const roomCategoryEnum = pgEnum('room_category', ROOM_CATEGORIES);
export const roomStatusEnum = pgEnum('room_status', ROOM_STATUSES);
export const applicationStatusEnum = pgEnum('application_status', APPLICATION_STATUSES);
export const paymentPurposeEnum = pgEnum('payment_purpose', PAYMENT_PURPOSES);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentProviderEnum = pgEnum('payment_provider', PAYMENT_PROVIDERS);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

const timestamps = {
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** One row per Supabase auth user. The foreign key to auth.users lives in a custom migration. */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    fullName: text('full_name'),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    gender: genderEnum('gender'),
    interestedIn: text('interested_in')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),
    lastSeenAt: timestamptz('last_seen_at'),
    ...timestamps,
  },
  (table) => [
    index('profiles_email_idx').on(table.email),
    index('profiles_last_seen_idx').on(table.lastSeenAt),
  ],
);

export const hostVerifications = pgTable(
  'host_verifications',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    about: text('about').notNull(),
    status: hostStatusEnum('status').notNull().default('pending'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, { onDelete: 'set null' }),
    reviewedAt: timestamptz('reviewed_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('host_display_name_unique').on(sql`lower(${table.displayName})`),
    index('host_status_idx').on(table.status),
  ],
);

export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    pricePaise: integer('price_paise').notNull(),
    durationDays: integer('duration_days').notNull(),
    capacity: integer('capacity').notNull(),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    check('plans_price_positive', sql`${table.pricePaise} > 0`),
    check('plans_fee_range', sql`${table.platformFeeBps} between 0 and 10000`),
  ],
);

export const features = pgTable('features', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  /** False means the feature is advertised as coming soon, not sold as available. */
  isLive: boolean('is_live').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const planFeatures = pgTable(
  'plan_features',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    featureKey: text('feature_key')
      .notNull()
      .references(() => features.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.planId, table.featureKey] })],
);

/**
 * A room copies its plan's terms when created. Editing a plan in the CMS therefore never
 * changes what an existing host already paid for.
 */
export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    hostId: uuid('host_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    description: text('description').notNull(),
    category: roomCategoryEnum('category').notNull(),
    ticketPricePaise: integer('ticket_price_paise').notNull(),
    planPricePaise: integer('plan_price_paise').notNull(),
    capacity: integer('capacity').notNull(),
    durationDays: integer('duration_days').notNull(),
    platformFeeBps: integer('platform_fee_bps').notNull(),
    entitlements: text('entitlements')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: roomStatusEnum('status').notNull().default('pending_payment'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    ...timestamps,
  },
  (table) => [
    index('rooms_explore_idx').on(table.status, table.endsAt),
    index('rooms_host_idx').on(table.hostId),
    check('rooms_ticket_positive', sql`${table.ticketPricePaise} > 0`),
    check('rooms_capacity_positive', sql`${table.capacity} > 0`),
  ],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    /** Per-room pseudonym, so one person cannot be tracked between rooms. */
    alias: text('alias').notNull(),
    message: text('message').notNull(),
    status: applicationStatusEnum('status').notNull().default('pending'),
    paymentDueAt: timestamptz('payment_due_at'),
    decidedAt: timestamptz('decided_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('applications_room_user_unique').on(table.roomId, table.userId),
    uniqueIndex('applications_room_alias_unique').on(table.roomId, table.alias),
    index('applications_room_status_idx').on(table.roomId, table.status),
    index('applications_user_idx').on(table.userId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    applicationId: uuid('application_id').references(() => applications.id, {
      onDelete: 'restrict',
    }),
    purpose: paymentPurposeEnum('purpose').notNull(),
    status: paymentStatusEnum('status').notNull().default('created'),
    provider: paymentProviderEnum('provider').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerPaymentId: text('provider_payment_id'),
    amountPaise: integer('amount_paise').notNull(),
    currency: text('currency').notNull().default('INR'),
    platformFeePaise: integer('platform_fee_paise').notNull().default(0),
    hostEarningPaise: integer('host_earning_paise').notNull().default(0),
    paidAt: timestamptz('paid_at'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('payments_provider_order_unique').on(table.provider, table.providerOrderId),
    uniqueIndex('payments_provider_payment_unique').on(table.provider, table.providerPaymentId),
    // At most one open order per thing being bought, so double clicks cannot double charge.
    uniqueIndex('payments_open_ticket_unique')
      .on(table.applicationId)
      .where(sql`status = 'created'`),
    uniqueIndex('payments_open_plan_unique')
      .on(table.roomId)
      .where(sql`status = 'created' and purpose = 'host_plan'`),
    index('payments_status_idx').on(table.status),
    index('payments_room_idx').on(table.roomId),
    check('payments_amount_positive', sql`${table.amountPaise} > 0`),
  ],
);

export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('admin_audit_entity_idx').on(table.entityType, table.entityId)],
);
