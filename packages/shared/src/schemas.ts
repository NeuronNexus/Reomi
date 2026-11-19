import { z } from 'zod';
import {
  APPLICATION_VIEW_STATUSES,
  ERROR_CODES,
  GENDERS,
  HOST_STATUSES,
  INTERESTS,
  MINIMUM_AGE,
  PAYMENT_PROVIDERS,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  ROOM_CATEGORIES,
  ROOM_STATUSES,
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
export const applicationStatusSchema = z.enum(APPLICATION_VIEW_STATUSES);
export const hostStatusSchema = z.enum(HOST_STATUSES);
export const userRoleSchema = z.enum(USER_ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);
export const paymentPurposeSchema = z.enum(PAYMENT_PURPOSES);
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export const paymentProviderSchema = z.enum(PAYMENT_PROVIDERS);

export const uuidParam = z.object({ id: z.uuid() });

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

export const meResponse = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: genderSchema.nullable(),
  interestedIn: z.array(interestSchema),
  role: userRoleSchema,
  onboarded: z.boolean(),
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
  features: z.array(featureDto),
});

/* Rooms ----------------------------------------------------------------------------------- */

export const roomListQuery = paginationQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
  category: roomCategorySchema.optional(),
  q: z.string().trim().max(80).optional(),
});

export const roomCardDto = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string(),
  category: roomCategorySchema,
  ticketPricePaise: z.number().int(),
  capacity: z.number().int(),
  seatsLeft: z.number().int(),
  durationDays: z.number().int(),
  startsAt: isoDateTime,
  endsAt: isoDateTime,
  host: z.object({ displayName: z.string(), roomsHosted: z.number().int() }),
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
  createdAt: isoDateTime,
});

export const roomDetailDto = roomCardDto.extend({
  description: z.string(),
  isHost: z.boolean(),
  myApplication: myApplicationDto.nullable(),
});

export const applyInput = z.object({ message: trimmed(10, 500) });

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
  createdAt: isoDateTime,
});

export const decisionInput = z.object({ decision: z.enum(['accept', 'reject']) });

export const hostRoomDto = z.object({
  id: z.uuid(),
  title: z.string(),
  summary: z.string(),
  category: roomCategorySchema,
  status: roomStatusSchema,
  live: z.boolean(),
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

/* Inferred types -------------------------------------------------------------------------- */

export type ApiError = z.infer<typeof errorResponseSchema>;
export type OnboardingInput = z.infer<typeof onboardingInput>;
export type Me = z.infer<typeof meResponse>;
export type Feature = z.infer<typeof featureDto>;
export type Plan = z.infer<typeof planDto>;
export type RoomCard = z.infer<typeof roomCardDto>;
export type RoomDetail = z.infer<typeof roomDetailDto>;
export type MyApplication = z.infer<typeof myApplicationDto>;
export type Lobby = z.infer<typeof lobbyDto>;
export type HostApplicationInput = z.infer<typeof hostApplicationInput>;
export type CreateRoomInput = z.infer<typeof createRoomInput>;
export type Applicant = z.infer<typeof applicantDto>;
export type HostRoom = z.infer<typeof hostRoomDto>;
export type HostRoomDashboard = z.infer<typeof hostRoomDashboardDto>;
export type Checkout = z.infer<typeof checkoutDto>;
export type PaymentResult = z.infer<typeof paymentResultDto>;
export type AdminStats = z.infer<typeof adminStatsDto>;
export type AdminUser = z.infer<typeof adminUserDto>;
export type AdminHost = z.infer<typeof adminHostDto>;
export type AdminRoom = z.infer<typeof adminRoomDto>;
export type AdminPlan = z.infer<typeof adminPlanDto>;
export type AdminPlanInput = z.infer<typeof adminPlanInput>;
export type AdminFeatureInput = z.infer<typeof adminFeatureInput>;
export type AdminPayment = z.infer<typeof adminPaymentDto>;
export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };
