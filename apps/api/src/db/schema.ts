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
  ACTIVITY_KINDS,
  APPLICATION_STATUSES,
  BALANCE_MODES,
  COMMUNITY_TOPICS,
  COMMUNITY_VISIBILITIES,
  CONNECTION_STAGES,
  FLAG_REASONS,
  FLAG_SEVERITIES,
  FLAG_STATUSES,
  GENDERS,
  HOST_STATUSES,
  MEDIA_PURPOSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  MESSAGE_KINDS,
  PAYMENT_PROVIDERS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  POST_KINDS,
  REVEAL_STATUSES,
  ROOM_ADMISSIONS,
  ROOM_CATEGORIES,
  ROOM_STATUSES,
  ROOM_VISIBILITIES,
  SENDER_ROLES,
  THREAD_KINDS,
  USER_ROLES,
  USER_STATUSES,
} from '@reomi/shared';

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
export const roomVisibilityEnum = pgEnum('room_visibility', ROOM_VISIBILITIES);
export const roomAdmissionEnum = pgEnum('room_admission', ROOM_ADMISSIONS);
export const balanceModeEnum = pgEnum('balance_mode', BALANCE_MODES);
export const messageKindEnum = pgEnum('message_kind', MESSAGE_KINDS);
export const senderRoleEnum = pgEnum('sender_role', SENDER_ROLES);
export const threadKindEnum = pgEnum('thread_kind', THREAD_KINDS);
export const revealStatusEnum = pgEnum('reveal_status', REVEAL_STATUSES);
export const connectionStageEnum = pgEnum('connection_stage', CONNECTION_STAGES);
export const activityKindEnum = pgEnum('activity_kind', ACTIVITY_KINDS);
export const flagReasonEnum = pgEnum('flag_reason', FLAG_REASONS);
export const flagSeverityEnum = pgEnum('flag_severity', FLAG_SEVERITIES);
export const flagStatusEnum = pgEnum('flag_status', FLAG_STATUSES);
export const communityTopicEnum = pgEnum('community_topic', COMMUNITY_TOPICS);
export const communityVisibilityEnum = pgEnum('community_visibility', COMMUNITY_VISIBILITIES);
export const memberRoleEnum = pgEnum('member_role', MEMBER_ROLES);
export const memberStatusEnum = pgEnum('member_status', MEMBER_STATUSES);
export const postKindEnum = pgEnum('post_kind', POST_KINDS);
export const mediaPurposeEnum = pgEnum('media_purpose', MEDIA_PURPOSES);

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
    /** Private details shown only after a mutual reveal. */
    bio: text('bio').notNull().default(''),
    city: text('city').notNull().default(''),
    avatarPath: text('avatar_path'),
    role: userRoleEnum('role').notNull().default('user'),
    status: userStatusEnum('status').notNull().default('active'),
    /** Temporary restriction from the moderation ladder: no messages until this time. */
    mutedUntil: timestamptz('muted_until'),
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
    /** The id hosts are known by in public, so their account id never appears on public pages. */
    publicId: uuid('public_id').notNull().defaultRandom().unique(),
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
    /** Published benchmark ticket; group-room tickets may exceed it by `ticketCapBps` at most. */
    referenceTicketPaise: integer('reference_ticket_paise').notNull().default(30_000),
    ticketCapBps: integer('ticket_cap_bps').notNull().default(1000),
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
    visibility: roomVisibilityEnum('visibility').notNull().default('public'),
    admission: roomAdmissionEnum('admission').notNull().default('approval'),
    balanceMode: balanceModeEnum('balance_mode').notNull().default('balanced'),
    /** Shared by the host so people can find a private room. */
    inviteCode: text('invite_code')
      .notNull()
      .default(sql`upper(substr(md5(random()::text), 1, 8))`),
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
    /** When the host wants the room to open; it opens at payment time when this is null. */
    scheduledFor: timestamptz('scheduled_for'),
    startsAt: timestamptz('starts_at'),
    endsAt: timestamptz('ends_at'),
    /** Bookkeeping for the notification sweeper, so each notice goes out once. */
    announcedAt: timestamptz('announced_at'),
    openNotifiedAt: timestamptz('open_notified_at'),
    endNotifiedAt: timestamptz('end_notified_at'),
    ...timestamps,
  },
  (table) => [
    index('rooms_explore_idx').on(table.status, table.endsAt),
    uniqueIndex('rooms_invite_code_unique').on(table.inviteCode),
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

/* Phase 1: rooms come alive ------------------------------------------------------------------ */

/**
 * One-to-one conversations. A `whisper` is anonymous and lives inside a room; a `dm` is between two
 * people who revealed to each other. `user_a` is always the smaller id so a pair has one thread.
 */
export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: threadKindEnum('kind').notNull(),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
    userA: uuid('user_a')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    userB: uuid('user_b')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamptz('last_message_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('threads_whisper_unique')
      .on(table.roomId, table.userA, table.userB)
      .where(sql`kind = 'whisper'`),
    uniqueIndex('threads_dm_unique').on(table.userA, table.userB).where(sql`kind = 'dm'`),
    index('threads_user_a_idx').on(table.userA),
    index('threads_user_b_idx').on(table.userB),
    check('threads_ordered_pair', sql`${table.userA} < ${table.userB}`),
  ],
);

export const roomActivities = pgTable(
  'room_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    kind: activityKindEnum('kind').notNull(),
    title: text('title').notNull(),
    options: text('options')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('room_activities_room_idx').on(table.roomId)],
);

export const activityResponses = pgTable(
  'activity_responses',
  {
    activityId: uuid('activity_id')
      .notNull()
      .references(() => roomActivities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    choice: integer('choice'),
    answer: text('answer'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.activityId, table.userId] })],
);

/**
 * Room chat and thread messages in one table. Senders in anonymous places are stored with the
 * alias they used, and the API never returns `sender_id` for them.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').references(() => profiles.id, { onDelete: 'set null' }),
    senderName: text('sender_name').notNull(),
    senderRole: senderRoleEnum('sender_role').notNull(),
    kind: messageKindEnum('kind').notNull().default('text'),
    body: text('body').notNull(),
    activityId: uuid('activity_id').references(() => roomActivities.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('messages_room_idx').on(table.roomId, table.createdAt),
    index('messages_thread_idx').on(table.threadId, table.createdAt),
    check(
      'messages_one_place',
      sql`(${table.roomId} is not null and ${table.threadId} is null)
        or (${table.roomId} is null and ${table.threadId} is not null)`,
    ),
  ],
);

/** A request to show real profiles to each other. Nobody can reveal anyone unilaterally. */
export const reveals = pgTable(
  'reveals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    status: revealStatusEnum('status').notNull().default('pending'),
    requesterAnnounce: boolean('requester_announce').notNull().default(false),
    recipientAnnounce: boolean('recipient_announce').notNull().default(false),
    /** Both must confirm before the connection counts toward the host's record. */
    requesterConfirmedAt: timestamptz('requester_confirmed_at'),
    recipientConfirmedAt: timestamptz('recipient_confirmed_at'),
    requesterStage: connectionStageEnum('requester_stage'),
    recipientStage: connectionStageEnum('recipient_stage'),
    respondedAt: timestamptz('responded_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('reveals_open_pair_unique')
      .on(
        table.roomId,
        sql`least(${table.requesterId}, ${table.recipientId})`,
        sql`greatest(${table.requesterId}, ${table.recipientId})`,
      )
      .where(sql`status in ('pending', 'accepted')`),
    index('reveals_requester_idx').on(table.requesterId),
    index('reveals_recipient_idx').on(table.recipientId),
    index('reveals_room_idx').on(table.roomId),
  ],
);

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followeeId] }),
    index('follows_followee_idx').on(table.followeeId),
  ],
);

export const hostRatings = pgTable(
  'host_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    hostId: uuid('host_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    stars: integer('stars').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('host_ratings_room_user_unique').on(table.roomId, table.userId),
    index('host_ratings_host_idx').on(table.hostId),
    check('host_ratings_stars_range', sql`${table.stars} between 1 and 5`),
  ],
);

export const roomWaitlist = pgTable(
  'room_waitlist',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.userId] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    link: text('link'),
    readAt: timestamptz('read_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('notifications_user_idx').on(table.userId, table.createdAt)],
);

export const moderationFlags = pgTable(
  'moderation_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    reporterId: uuid('reporter_id').references(() => profiles.id, { onDelete: 'set null' }),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    communityId: uuid('community_id'),
    context: text('context').notNull(),
    reason: flagReasonEnum('reason').notNull(),
    severity: flagSeverityEnum('severity').notNull(),
    status: flagStatusEnum('status').notNull().default('open'),
    /** The blocked text, visible to administrators only. */
    excerpt: text('excerpt').notNull(),
    reviewedBy: uuid('reviewed_by').references(() => profiles.id, { onDelete: 'set null' }),
    reviewedAt: timestamptz('reviewed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('moderation_flags_user_idx').on(table.userId, table.createdAt),
    index('moderation_flags_status_idx').on(table.status),
  ],
);

/* Phase 2: private interest communities ------------------------------------------------------ */

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    purpose: mediaPurposeEnum('purpose').notNull(),
    path: text('path').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    /** Set once the file is attached to a post, story or profile, so it can be used only once. */
    attachedAt: timestamptz('attached_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('media_owner_idx').on(table.ownerId)],
);

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    tagline: text('tagline').notNull(),
    description: text('description').notNull(),
    rules: text('rules').notNull().default(''),
    topic: communityTopicEnum('topic').notNull(),
    visibility: communityVisibilityEnum('visibility').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('communities_name_unique').on(sql`lower(${table.name})`),
    index('communities_topic_idx').on(table.topic),
  ],
);

/** Each membership carries its own display name, so interests need not share one identity. */
export const communityMembers = pgTable(
  'community_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: memberRoleEnum('role').notNull().default('member'),
    status: memberStatusEnum('status').notNull().default('active'),
    displayName: text('display_name').notNull(),
    useProfilePhoto: boolean('use_profile_photo').notNull().default(false),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('community_members_unique').on(table.communityId, table.userId),
    uniqueIndex('community_members_name_unique').on(
      table.communityId,
      sql`lower(${table.displayName})`,
    ),
    index('community_members_user_idx').on(table.userId),
  ],
);

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => communityMembers.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    kind: postKindEnum('kind').notNull(),
    body: text('body').notNull().default(''),
    mediaIds: uuid('media_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    removedAt: timestamptz('removed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('posts_community_idx').on(table.communityId, table.createdAt),
    index('posts_kind_idx').on(table.kind, table.createdAt),
  ],
);

export const postLikes = pgTable(
  'post_likes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.postId, table.userId] })],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => communityMembers.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    removedAt: timestamptz('removed_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('post_comments_post_idx').on(table.postId, table.createdAt)],
);

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => communityMembers.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    caption: text('caption').notNull().default(''),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [index('stories_community_idx').on(table.communityId, table.expiresAt)],
);
