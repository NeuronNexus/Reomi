import { z } from 'zod';
import {
  ACTIVITY_KINDS,
  APPLICATION_VIEW_STATUSES,
  BALANCE_MODES,
  COMMUNITY_TOPICS,
  COMMUNITY_VISIBILITIES,
  CONNECTION_STAGES,
  ERROR_CODES,
  FLAG_REASONS,
  FLAG_SEVERITIES,
  FLAG_STATUSES,
  GENDERS,
  HOST_STATUSES,
  INTERESTS,
  MEDIA_PURPOSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  MESSAGE_KINDS,
  MINIMUM_AGE,
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
} from './constants';
import { ageOn } from './format';

/* Primitives ------------------------------------------------------------------------------ */

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
const isoDateTime = z.string();

export const genderSchema = z.enum(GENDERS);
export const interestSchema = z.enum(INTERESTS);
export const roomCategorySchema = z.enum(ROOM_CATEGORIES);
export const roomStatusSchema = z.enum(ROOM_STATUSES);
export const roomVisibilitySchema = z.enum(ROOM_VISIBILITIES);
export const roomAdmissionSchema = z.enum(ROOM_ADMISSIONS);
export const balanceModeSchema = z.enum(BALANCE_MODES);
export const applicationStatusSchema = z.enum(APPLICATION_VIEW_STATUSES);
export const hostStatusSchema = z.enum(HOST_STATUSES);
export const userRoleSchema = z.enum(USER_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);
export const paymentPurposeSchema = z.enum(PAYMENT_PURPOSES);
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);
export const activityKindSchema = z.enum(ACTIVITY_KINDS);
export const revealStatusSchema = z.enum(REVEAL_STATUSES);
export const connectionStageSchema = z.enum(CONNECTION_STAGES);
export const communityTopicSchema = z.enum(COMMUNITY_TOPICS);
export const communityVisibilitySchema = z.enum(COMMUNITY_VISIBILITIES);
export const memberRoleSchema = z.enum(MEMBER_ROLES);
export const memberStatusSchema = z.enum(MEMBER_STATUSES);
export const postKindSchema = z.enum(POST_KINDS);
export const mediaPurposeSchema = z.enum(MEDIA_PURPOSES);

export const uuidParam = z.object({ id: z.uuid() });
export const slugParam = z.object({ slug: z.string().trim().min(2).max(60) });

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** Cursor pages for timelines: pass the oldest `createdAt` you have as `before`. */
export const cursorQuery = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

/* Account --------------------------------------------------------------------------------- */

export const onboardingInput = z.object({
  fullName: trimmed(2, 80),
  dateOfBirth: z.iso
    .date()
    .refine((value) => ageOn(value) >= MINIMUM_AGE, `You must be ${MINIMUM_AGE} or older`)
    .refine((value) => ageOn(value) <= 120, 'Enter a valid date of birth'),
  gender: genderSchema,
  interestedIn: z.array(interestSchema).min(1, 'Choose at least one').max(INTERESTS.length),
});

/** The private profile shown only after a mutual reveal. */
export const profileInput = z.object({
  fullName: trimmed(2, 80),
  bio: z.string().trim().max(300).default(''),
  city: z.string().trim().max(60).default(''),
  interestedIn: z.array(interestSchema).min(1).max(INTERESTS.length),
  /** An uploaded `avatar` media id, `null` to remove the photo, or omitted to keep it. */
  avatarMediaId: z.uuid().nullable().optional(),
});

export const meResponse = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: genderSchema.nullable(),
  interestedIn: z.array(interestSchema),
  bio: z.string(),
  city: z.string(),
  avatarUrl: z.string().nullable(),
  role: userRoleSchema,
  onboarded: z.boolean(),
  mutedUntil: isoDateTime.nullable(),
  strikes: z.number().int(),
  host: z
    .object({
      status: hostStatusSchema,
      displayName: z.string(),
      reviewNote: z.string().nullable(),
    })
    .nullable(),
});

/* Plans ----------------------------------------------------------------------------------- */

export const featureDto = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  isLive: z.boolean(),
  sortOrder: z.number().int(),
});

export const planDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  pricePaise: z.number().int(),
  durationDays: z.number().int(),
  capacity: z.number().int(),
  platformFeeBps: z.number().int(),
  /** The published benchmark ticket for this plan's rooms. */
  referenceTicketPaise: z.number().int(),
  ticketCapBps: z.number().int(),
  /** The highest ticket a host on this plan may charge for a group room. */
  maxTicketPaise: z.number().int(),
  features: z.array(featureDto),
});

/* Hosts ----------------------------------------------------------------------------------- */

export const HOST_BADGES = ['verified', 'top_host', 'celebrity', 'rising'] as const;
export const hostBadgeSchema = z.enum(HOST_BADGES);

export const hostSummaryDto = z.object({
  /** The host's public id. Their account id is never exposed. */
  id: z.uuid(),
  displayName: z.string(),
  roomsHosted: z.number().int(),
  rating: z.number().nullable(),
  ratingCount: z.number().int(),
  verifiedConnections: z.number().int(),
  badges: z.array(hostBadgeSchema),
});

export const hostStatsDto = z.object({
  roomsHosted: z.number().int(),
  roomsCompleted: z.number().int(),
  participantsServed: z.number().int(),
  rating: z.number().nullable(),
  ratingCount: z.number().int(),
  ratingDistribution: z.array(z.number().int()),
  verifiedConnections: z.number().int(),
  revealsFacilitated: z.number().int(),
  followers: z.number().int(),
  score: z.number(),
  rank: z.number().int().nullable(),
});

export const reviewDto = z.object({
  stars: z.number().int(),
  comment: z.string(),
  roomTitle: z.string(),
  createdAt: isoDateTime,
});

export const leaderboardEntryDto = z.object({
  rank: z.number().int(),
  host: hostSummaryDto,
  stats: hostStatsDto,
});

/* Rooms ----------------------------------------------------------------------------------- */

export const roomListQuery = paginationQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  category: roomCategorySchema.optional(),
  q: z.string().trim().max(80).optional(),
  when: z.enum(['live', 'upcoming', 'all']).default('all'),
  hostId: z.uuid().optional(),
  ids: z.string().max(200).optional(),
});

export const roomCardDto = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string(),
  category: roomCategorySchema,
  visibility: roomVisibilitySchema,
  admission: roomAdmissionSchema,
  balanceMode: balanceModeSchema,
  ticketPricePaise: z.number().int(),
  capacity: z.number().int(),
  seatsLeft: z.number().int(),
  durationDays: z.number().int(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  upcoming: z.boolean(),
  waitlistCount: z.number().int(),
  onWaitlist: z.boolean(),
  /** Only for signed-in viewers: whether the balance rules would admit them right now. */
  fit: z.enum(['good', 'paused']).nullable(),
  host: hostSummaryDto,
});

export const myApplicationDto = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  roomTitle: z.string(),
  alias: z.string(),
  message: z.string(),
  status: applicationStatusSchema,
  paymentDueAt: isoDateTime.nullable(),
  ticketPricePaise: z.number().int(),
  roomEndsAt: isoDateTime.nullable(),
  /** Why a pending application cannot be accepted yet, for example the balance rules. */
  admissionNote: z.string().nullable(),
  createdAt: isoDateTime,
});

export const balanceGroupDto = z.object({
  group: interestSchema,
  demand: z.number(),
  supply: z.number().int(),
});

export const roomDetailDto = roomCardDto.extend({
  description: z.string(),
  isHost: z.boolean(),
  platformFeeBps: z.number().int(),
  myApplication: myApplicationDto.nullable(),
  /** The viewer's admission outlook, null when signed out or balancing is off. */
  balance: z.object({ ok: z.boolean(), message: z.string().nullable() }).nullable(),
  suggestions: z.array(roomCardDto),
  inviteCodeRequired: z.boolean(),
});

export const applyInput = z.object({
  message: trimmed(10, 500),
  inviteCode: z.string().trim().max(20).optional(),
});

export const lobbyDto = z.object({
  roomId: z.uuid(),
  title: z.string(),
  endsAt: isoDateTime.nullable(),
  yourAlias: z.string().nullable(),
  members: z.array(z.object({ alias: z.string() })),
});

/* Hosting --------------------------------------------------------------------------------- */

export const hostApplicationInput = z.object({
  displayName: trimmed(3, 40),
  about: trimmed(30, 1000),
});

export const createRoomInput = z.object({
  planId: z.uuid(),
  title: trimmed(5, 80),
  summary: trimmed(10, 160),
  description: trimmed(30, 2000),
  category: roomCategorySchema,
  ticketPricePaise: z
    .number()
    .int()
    .min(100, 'Ticket must be at least ₹1')
    .max(10_000_000, 'Ticket cannot exceed ₹1,00,000'),
  visibility: roomVisibilitySchema.default('public'),
  admission: roomAdmissionSchema.default('approval'),
  balanceMode: balanceModeSchema.default('balanced'),
  /** Open later instead of as soon as the plan is paid. */
  scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
});

/** What a host sees of an applicant. Deliberately has no name, email, age or user id. */
export const applicantDto = z.object({
  id: z.uuid(),
  alias: z.string(),
  gender: genderSchema.nullable(),
  interestedIn: z.array(interestSchema),
  message: z.string(),
  status: applicationStatusSchema,
  paymentDueAt: isoDateTime.nullable(),
  /** False when accepting would break the room's interest balance right now. */
  admissible: z.boolean(),
  blockedReason: z.string().nullable(),
  createdAt: isoDateTime,
});

export const decisionInput = z.object({ decision: z.enum(['accept', 'reject']) });

export const hostRoomDto = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string(),
  category: roomCategorySchema,
  status: roomStatusSchema,
  visibility: roomVisibilitySchema,
  admission: roomAdmissionSchema,
  balanceMode: balanceModeSchema,
  inviteCode: z.string(),
  live: z.boolean(),
  upcoming: z.boolean(),
  planName: z.string(),
  ticketPricePaise: z.number().int(),
  capacity: z.number().int(),
  durationDays: z.number().int(),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  counts: z.object({
    pending: z.number().int(),
    accepted: z.number().int(),
    joined: z.number().int(),
  }),
  createdAt: isoDateTime,
});

export const hostRoomDashboardDto = hostRoomDto.extend({
  entitlements: z.array(z.string()),
  activityKinds: z.array(activityKindSchema),
  balance: z.object({ healthy: z.boolean(), groups: z.array(balanceGroupDto) }),
  waitlistCount: z.number().int(),
  ratings: z.object({ average: z.number().nullable(), count: z.number().int() }),
  connections: z.object({ reveals: z.number().int(), verified: z.number().int() }),
  /** Present only when the room's plan includes detailed analytics. */
  demand: z
    .object({
      seeking: z.array(z.object({ interest: interestSchema, count: z.number().int() })),
      gender: z.array(z.object({ gender: genderSchema, count: z.number().int() })),
    })
    .nullable(),
  /** Present only when the room's plan includes advanced analytics. */
  funnel: z
    .object({
      applied: z.number().int(),
      accepted: z.number().int(),
      joined: z.number().int(),
      grossPaise: z.number().int(),
      platformFeePaise: z.number().int(),
      hostEarningsPaise: z.number().int(),
    })
    .nullable(),
});

/* Room space: chat, activities, reveals --------------------------------------------------- */

export const senderDto = z.object({
  /** Alias in rooms and whispers, user id in direct messages. Compare with your own key. */
  key: z.string(),
  name: z.string(),
  role: z.enum(SENDER_ROLES),
  avatarUrl: z.string().nullable(),
});

export const activityDto = z.object({
  id: z.uuid(),
  kind: activityKindSchema,
  title: z.string(),
  options: z.array(z.string()),
  results: z.array(z.number().int()),
  responses: z.number().int(),
  answers: z.array(z.object({ alias: z.string(), text: z.string() })),
  myChoice: z.number().int().nullable(),
  myAnswer: z.string().nullable(),
  createdAt: isoDateTime,
});

export const messageDto = z.object({
  id: z.uuid(),
  roomId: z.uuid().nullable(),
  threadId: z.uuid().nullable(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string(),
  sender: senderDto,
  activity: activityDto.nullable(),
  createdAt: isoDateTime,
});

export const sendMessageInput = z.object({ body: trimmed(1, 1000) });

export const blockedMessageDetails = z.object({
  reason: z.enum(FLAG_REASONS),
  severity: z.enum(FLAG_SEVERITIES),
  strikes: z.number().int(),
  action: z.enum(['none', 'warning', 'muted', 'removed', 'suspended']),
});

export const spaceMemberDto = z.object({
  alias: z.string(),
  revealed: z.boolean(),
  isYou: z.boolean(),
});

export const revealedProfileDto = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  age: z.number().int().nullable(),
  gender: genderSchema.nullable(),
  city: z.string(),
  bio: z.string(),
  avatarUrl: z.string().nullable(),
});

export const revealDto = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  roomTitle: z.string(),
  direction: z.enum(['outgoing', 'incoming']),
  status: revealStatusSchema,
  /** The other person's alias in that room. */
  otherAlias: z.string(),
  /** Present only once both people agreed. */
  profile: revealedProfileDto.nullable(),
  youConfirmed: z.boolean(),
  theyConfirmed: z.boolean(),
  stage: connectionStageSchema.nullable(),
  threadId: z.uuid().nullable(),
  createdAt: isoDateTime,
});

export const spaceDto = z.object({
  roomId: z.uuid(),
  title: z.string(),
  category: roomCategorySchema,
  live: z.boolean(),
  ended: z.boolean(),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  isHost: z.boolean(),
  host: z.object({ id: z.uuid(), displayName: z.string() }),
  you: z.object({ key: z.string(), name: z.string() }),
  members: z.array(spaceMemberDto),
  activityKinds: z.array(activityKindSchema),
  reveals: z.array(revealDto),
  canRate: z.boolean(),
  rated: z.boolean(),
  mutedUntil: isoDateTime.nullable(),
});

export const revealRequestInput = z.object({
  toAlias: trimmed(1, 80),
  announce: z.boolean().default(false),
});

export const revealRespondInput = z.object({
  accept: z.boolean(),
  announce: z.boolean().default(false),
});

export const confirmConnectionInput = z.object({ stage: connectionStageSchema });

export const whisperInput = z.object({ toAlias: trimmed(1, 80) });

export const threadDto = z.object({
  id: z.uuid(),
  kind: z.enum(THREAD_KINDS),
  roomId: z.uuid().nullable(),
  roomTitle: z.string().nullable(),
  you: z.object({ key: z.string(), name: z.string() }),
  other: senderDto,
  lastMessage: z.string().nullable(),
  lastMessageAt: isoDateTime.nullable(),
  /** Whispers between two people who revealed to each other may share contact details. */
  revealed: z.boolean(),
});

export const createActivityInput = z.object({
  kind: activityKindSchema,
  title: trimmed(3, 200),
  options: z.array(trimmed(1, 60)).max(6).default([]),
});

export const activityRespondInput = z.object({
  choice: z.number().int().min(0).max(5).optional(),
  text: z.string().trim().min(1).max(500).optional(),
});

export const ratingInput = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).default(''),
});

export const followDto = z.object({
  /** A host's public id, or a revealed connection's user id. */
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(['host', 'connection']),
  avatarUrl: z.string().nullable(),
});

export const hostProfileDto = z.object({
  host: hostSummaryDto,
  about: z.string(),
  stats: hostStatsDto,
  live: z.array(roomCardDto),
  upcoming: z.array(roomCardDto),
  past: z.array(
    z.object({ id: z.uuid(), title: z.string(), endedAt: isoDateTime, participants: z.number() }),
  ),
  reviews: z.array(reviewDto),
  isFollowing: z.boolean(),
  isYou: z.boolean(),
});

/* Notifications --------------------------------------------------------------------------- */

export const notificationDto = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  read: z.boolean(),
  createdAt: isoDateTime,
});

export const notificationsDto = z.object({
  items: z.array(notificationDto),
  unread: z.number().int(),
});

/* Payments -------------------------------------------------------------------------------- */

export const checkoutDto = z.object({
  paymentId: z.uuid(),
  provider: paymentProviderSchema,
  publicKey: z.string(),
  orderId: z.string(),
  amountPaise: z.number().int(),
  currency: z.string(),
  description: z.string(),
});

export const createRoomResponse = z.object({ roomId: z.uuid(), checkout: checkoutDto });

export const confirmPaymentInput = z.object({
  providerPaymentId: trimmed(1, 100),
  signature: trimmed(1, 200),
});

export const paymentResultDto = z.object({
  paymentId: z.uuid(),
  status: paymentStatusSchema,
  roomId: z.uuid(),
  /** Signature checked out but the money is not captured yet; a webhook will settle it. */
  processing: z.boolean(),
});

/* Media ----------------------------------------------------------------------------------- */

export const mediaUploadInput = z.object({
  purpose: mediaPurposeSchema,
  contentType: z.string().trim().max(100),
  size: z.number().int().min(1),
});

export const mediaUploadDto = z.object({
  mediaId: z.uuid(),
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
});

export const mediaDto = z.object({
  id: z.uuid(),
  url: z.string(),
  type: z.enum(['image', 'video']),
});

/* Communities ----------------------------------------------------------------------------- */

export const communityListQuery = paginationQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  topic: communityTopicSchema.optional(),
  q: z.string().trim().max(80).optional(),
  mine: z.coerce.boolean().optional(),
});

export const communityDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  tagline: z.string(),
  topic: communityTopicSchema,
  visibility: communityVisibilitySchema,
  memberCount: z.number().int(),
  postCount: z.number().int(),
  myStatus: memberStatusSchema.nullable(),
  myRole: memberRoleSchema.nullable(),
});

export const communityDetailDto = communityDto.extend({
  description: z.string(),
  rules: z.string(),
  myDisplayName: z.string().nullable(),
  pendingRequests: z.number().int(),
  createdAt: isoDateTime,
});

export const createCommunityInput = z.object({
  name: trimmed(3, 50),
  tagline: trimmed(5, 120),
  description: trimmed(10, 1500),
  rules: z.string().trim().max(1500).default(''),
  topic: communityTopicSchema,
  visibility: communityVisibilitySchema,
  displayName: trimmed(2, 40),
});

export const joinCommunityInput = z.object({
  displayName: trimmed(2, 40),
  useProfilePhoto: z.boolean().default(false),
});

export const memberDto = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: memberRoleSchema,
  status: memberStatusSchema,
  avatarUrl: z.string().nullable(),
  isYou: z.boolean(),
  joinedAt: isoDateTime,
});

export const memberPatch = z
  .object({ role: z.enum(['moderator', 'member']).optional(), status: memberStatusSchema.optional() })
  .refine((value) => value.role || value.status, 'Nothing to change');

export const authorDto = z.object({
  memberId: z.uuid(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: memberRoleSchema,
});

export const postDto = z.object({
  id: z.uuid(),
  community: z.object({ slug: z.string(), name: z.string() }),
  kind: postKindSchema,
  body: z.string(),
  media: z.array(mediaDto),
  author: authorDto,
  likeCount: z.number().int(),
  commentCount: z.number().int(),
  likedByYou: z.boolean(),
  canDelete: z.boolean(),
  createdAt: isoDateTime,
});

export const createPostInput = z
  .object({
    kind: postKindSchema,
    body: z.string().trim().max(2000).default(''),
    mediaIds: z.array(z.uuid()).max(6).default([]),
  })
  .refine((value) => value.kind !== 'text' || value.body.length > 0, 'Write something first')
  .refine(
    (value) => value.kind === 'text' || value.mediaIds.length > 0,
    'Add a photo or video first',
  );

export const commentDto = z.object({
  id: z.uuid(),
  body: z.string(),
  author: authorDto,
  canDelete: z.boolean(),
  createdAt: isoDateTime,
});

export const createCommentInput = z.object({ body: trimmed(1, 500) });

export const storyDto = z.object({
  id: z.uuid(),
  media: mediaDto,
  caption: z.string(),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
});

export const storyGroupDto = z.object({
  community: z.object({ slug: z.string(), name: z.string() }),
  author: authorDto,
  stories: z.array(storyDto),
});

export const createStoryInput = z.object({
  mediaId: z.uuid(),
  caption: z.string().trim().max(200).default(''),
});

export const reportInput = z.object({
  targetType: z.enum(['post', 'comment', 'message']),
  targetId: z.uuid(),
  reason: trimmed(3, 300),
});

/* Admin ----------------------------------------------------------------------------------- */

export const adminStatsDto = z.object({
  users: z.object({
    total: z.number().int(),
    active24h: z.number().int(),
    active30d: z.number().int(),
    suspended: z.number().int(),
  }),
  hosts: z.object({ verified: z.number().int(), pending: z.number().int() }),
  rooms: z.object({ live: z.number().int(), total: z.number().int() }),
  revenue: z.object({
    hostPlanPaise: z.number().int(),
    ticketGrossPaise: z.number().int(),
    platformFeePaise: z.number().int(),
    hostLiabilityPaise: z.number().int(),
    refundsDuePaise: z.number().int(),
  }),
  activity: z.object({
    messages24h: z.number().int(),
    reveals: z.number().int(),
    verifiedConnections: z.number().int(),
    communities: z.number().int(),
    posts24h: z.number().int(),
    openFlags: z.number().int(),
  }),
});

export const adminUserQuery = paginationQuery.extend({
  q: z.string().trim().max(120).optional(),
  status: userStatusSchema.optional(),
  activeWithinDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const adminUserDto = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: userRoleSchema,
  status: userStatusSchema,
  hostStatus: hostStatusSchema.nullable(),
  strikes: z.number().int(),
  lastSeenAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const adminUserPatch = z.object({ status: userStatusSchema });

export const adminHostQuery = paginationQuery.extend({
  status: hostStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

export const adminHostDto = z.object({
  userId: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  displayName: z.string(),
  about: z.string(),
  status: hostStatusSchema,
  reviewNote: z.string().nullable(),
  reviewedAt: isoDateTime.nullable(),
  roomsHosted: z.number().int(),
  liveRooms: z.number().int(),
  createdAt: isoDateTime,
});

export const adminHostDecision = z.object({
  status: z.enum(['verified', 'rejected', 'revoked']),
  reviewNote: z.string().trim().max(500).optional(),
});

export const adminRoomQuery = paginationQuery.extend({
  status: roomStatusSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

export const adminRoomDto = z.object({
  id: z.uuid(),
  title: z.string(),
  category: roomCategorySchema,
  status: roomStatusSchema,
  visibility: roomVisibilitySchema,
  live: z.boolean(),
  hostDisplayName: z.string(),
  hostEmail: z.string(),
  planId: z.uuid(),
  planName: z.string(),
  ticketPricePaise: z.number().int(),
  capacity: z.number().int(),
  durationDays: z.number().int(),
  seatsTaken: z.number().int(),
  pendingApplications: z.number().int(),
  entitlements: z.array(z.string()),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const adminRoomPatch = z
  .object({ planId: z.uuid().optional(), status: z.enum(['open', 'closed']).optional() })
  .refine((value) => value.planId || value.status, 'Nothing to change');

export const adminPlanDto = planDto.extend({
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  roomCount: z.number().int(),
});

export const adminPlanInput = z.object({
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, numbers and dashes only'),
  name: trimmed(2, 40),
  description: trimmed(2, 200),
  pricePaise: z.number().int().min(100).max(100_000_000),
  durationDays: z.number().int().min(1).max(365),
  capacity: z.number().int().min(2).max(10_000),
  platformFeeBps: z.number().int().min(0).max(10_000),
  referenceTicketPaise: z.number().int().min(100).max(10_000_000).default(30_000),
  ticketCapBps: z.number().int().min(0).max(10_000).default(1000),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});

export const adminPlanPatch = adminPlanInput.partial();

export const adminPlanFeaturesInput = z.object({ featureKeys: z.array(z.string()).max(100) });

export const adminFeatureInput = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{2,60}$/, 'Lowercase letters, numbers and underscores only'),
  name: trimmed(2, 80),
  description: trimmed(2, 240),
  isLive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});

export const adminFeaturePatch = adminFeatureInput.omit({ key: true }).partial();

export const adminPaymentQuery = paginationQuery.extend({
  status: paymentStatusSchema.optional(),
  purpose: paymentPurposeSchema.optional(),
});

export const adminPaymentDto = z.object({
  id: z.uuid(),
  purpose: paymentPurposeSchema,
  status: paymentStatusSchema,
  provider: paymentProviderSchema,
  providerOrderId: z.string(),
  providerPaymentId: z.string().nullable(),
  amountPaise: z.number().int(),
  platformFeePaise: z.number().int(),
  hostEarningPaise: z.number().int(),
  userEmail: z.string(),
  roomId: z.uuid(),
  roomTitle: z.string(),
  paidAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});

export const adminFlagQuery = paginationQuery.extend({
  status: z.enum(FLAG_STATUSES).optional(),
  severity: z.enum(FLAG_SEVERITIES).optional(),
});

export const adminFlagDto = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  userEmail: z.string(),
  userName: z.string().nullable(),
  userStatus: userStatusSchema,
  context: z.string(),
  reason: z.enum(FLAG_REASONS),
  severity: z.enum(FLAG_SEVERITIES),
  status: z.enum(FLAG_STATUSES),
  excerpt: z.string(),
  where: z.string().nullable(),
  reporterEmail: z.string().nullable(),
  strikes: z.number().int(),
  createdAt: isoDateTime,
});

export const adminFlagPatch = z.object({
  status: z.enum(['dismissed', 'actioned']),
  suspendUser: z.boolean().default(false),
});

export const adminCommunityDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  topic: communityTopicSchema,
  visibility: communityVisibilitySchema,
  memberCount: z.number().int(),
  postCount: z.number().int(),
  ownerEmail: z.string(),
  createdAt: isoDateTime,
});

/* Realtime -------------------------------------------------------------------------------- */

/** Messages the server pushes over the WebSocket, wrapped as `{ type: 'event', channel, event }`. */
export type RealtimeEvent =
  | { kind: 'message'; message: z.infer<typeof messageDto> }
  | { kind: 'activity'; activity: z.infer<typeof activityDto> }
  | { kind: 'members' }
  | { kind: 'reveals' }
  | { kind: 'notification'; notification: z.infer<typeof notificationDto> }
  | { kind: 'threads' };

/* Inferred types -------------------------------------------------------------------------- */

export type ApiError = z.infer<typeof errorResponseSchema>;
export type OnboardingInput = z.infer<typeof onboardingInput>;
export type ProfileInput = z.infer<typeof profileInput>;
export type Me = z.infer<typeof meResponse>;
export type Feature = z.infer<typeof featureDto>;
export type Plan = z.infer<typeof planDto>;
export type HostSummary = z.infer<typeof hostSummaryDto>;
export type HostStats = z.infer<typeof hostStatsDto>;
export type HostProfile = z.infer<typeof hostProfileDto>;
export type LeaderboardEntry = z.infer<typeof leaderboardEntryDto>;
export type Review = z.infer<typeof reviewDto>;
export type RoomCard = z.infer<typeof roomCardDto>;
export type RoomDetail = z.infer<typeof roomDetailDto>;
export type MyApplication = z.infer<typeof myApplicationDto>;
export type Lobby = z.infer<typeof lobbyDto>;
export type HostApplicationInput = z.infer<typeof hostApplicationInput>;
export type CreateRoomInput = z.infer<typeof createRoomInput>;
export type Applicant = z.infer<typeof applicantDto>;
export type HostRoom = z.infer<typeof hostRoomDto>;
export type HostRoomDashboard = z.infer<typeof hostRoomDashboardDto>;
export type BalanceGroup = z.infer<typeof balanceGroupDto>;
export type Sender = z.infer<typeof senderDto>;
export type Activity = z.infer<typeof activityDto>;
export type Message = z.infer<typeof messageDto>;
export type BlockedMessageDetails = z.infer<typeof blockedMessageDetails>;
export type Space = z.infer<typeof spaceDto>;
export type SpaceMember = z.infer<typeof spaceMemberDto>;
export type RevealedProfile = z.infer<typeof revealedProfileDto>;
export type Reveal = z.infer<typeof revealDto>;
export type Thread = z.infer<typeof threadDto>;
export type CreateActivityInput = z.infer<typeof createActivityInput>;
export type Follow = z.infer<typeof followDto>;
export type Notification = z.infer<typeof notificationDto>;
export type Notifications = z.infer<typeof notificationsDto>;
export type Checkout = z.infer<typeof checkoutDto>;
export type PaymentResult = z.infer<typeof paymentResultDto>;
export type MediaUpload = z.infer<typeof mediaUploadDto>;
export type Media = z.infer<typeof mediaDto>;
export type Community = z.infer<typeof communityDto>;
export type CommunityDetail = z.infer<typeof communityDetailDto>;
export type CreateCommunityInput = z.infer<typeof createCommunityInput>;
export type Member = z.infer<typeof memberDto>;
export type Author = z.infer<typeof authorDto>;
export type Post = z.infer<typeof postDto>;
export type CreatePostInput = z.infer<typeof createPostInput>;
export type Comment = z.infer<typeof commentDto>;
export type Story = z.infer<typeof storyDto>;
export type StoryGroup = z.infer<typeof storyGroupDto>;
export type AdminStats = z.infer<typeof adminStatsDto>;
export type AdminUser = z.infer<typeof adminUserDto>;
export type AdminHost = z.infer<typeof adminHostDto>;
export type AdminRoom = z.infer<typeof adminRoomDto>;
export type AdminPlan = z.infer<typeof adminPlanDto>;
export type AdminPlanInput = z.infer<typeof adminPlanInput>;
export type AdminFeatureInput = z.infer<typeof adminFeatureInput>;
export type AdminPayment = z.infer<typeof adminPaymentDto>;
export type AdminFlag = z.infer<typeof adminFlagDto>;
export type AdminCommunity = z.infer<typeof adminCommunityDto>;
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
