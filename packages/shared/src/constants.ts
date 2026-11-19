export const APP_NAME = 'Reomi';
export const MINIMUM_AGE = 18;
export const CURRENCY = 'INR';

export const GENDERS = ['woman', 'man', 'non_binary', 'other'] as const;
export const INTERESTS = ['women', 'men', 'non_binary'] as const;

/** Which "people I want to meet" group each gender belongs to, for balancing and matching. */
export const GENDER_GROUP = {
  woman: 'women',
  man: 'men',
  non_binary: 'non_binary',
  other: 'non_binary',
} as const satisfies Record<(typeof GENDERS)[number], (typeof INTERESTS)[number]>;

export const ROOM_CATEGORIES = [
  'dating',
  'friends',
  'hobbies',
  'personality',
  'small_group',
] as const;

export const ROOM_STATUSES = ['pending_payment', 'open', 'closed'] as const;
export const ROOM_VISIBILITIES = ['public', 'private'] as const;
/** `approval`: the host decides. `instant`: anyone the balance rules allow gets a seat offer. */
export const ROOM_ADMISSIONS = ['approval', 'instant'] as const;
/** Dating rooms are always balanced. Other rooms may turn balancing off. */
export const BALANCE_MODES = ['balanced', 'open'] as const;

/** Stored application states. `expired` is derived, see APPLICATION_VIEW_STATUSES. */
export const APPLICATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
  'joined',
  'left',
  'removed',
] as const;

/** What clients see: an `accepted` application past its payment deadline reads as `expired`. */
export const APPLICATION_VIEW_STATUSES = [...APPLICATION_STATUSES, 'expired'] as const;

export const HOST_STATUSES = ['pending', 'verified', 'rejected', 'revoked'] as const;
export const USER_ROLES = ['user', 'admin'] as const;
export const USER_STATUSES = ['active', 'suspended'] as const;

export const PAYMENT_PURPOSES = ['host_plan', 'room_ticket'] as const;
export const PAYMENT_STATUSES = ['created', 'paid', 'refund_required', 'refunded'] as const;
export const PAYMENT_PROVIDERS = ['razorpay', 'mock'] as const;

export const MESSAGE_KINDS = ['text', 'system', 'activity', 'announcement'] as const;
export const SENDER_ROLES = ['member', 'host', 'system', 'person'] as const;
export const THREAD_KINDS = ['whisper', 'dm'] as const;
export const REVEAL_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export const CONNECTION_STAGES = ['connection', 'talking', 'relationship'] as const;

/** Activity kinds and the plan feature each one needs. */
export const ACTIVITY_KINDS = ['prompt', 'this_or_that', 'poll', 'intro_round'] as const;
export const ACTIVITY_FEATURE: Record<(typeof ACTIVITY_KINDS)[number], string> = {
  prompt: 'activities_basic',
  this_or_that: 'activities_basic',
  poll: 'activities_extended',
  intro_round: 'activities_advanced',
};

export const FLAG_SEVERITIES = ['soft', 'strong', 'report'] as const;
export const FLAG_STATUSES = ['open', 'dismissed', 'actioned'] as const;
export const FLAG_REASONS = [
  'identity_other',
  'identity_self',
  'contact_info',
  'harassment',
  'user_report',
] as const;

export const COMMUNITY_TOPICS = [
  'fashion',
  'fitness',
  'art',
  'music',
  'tech',
  'lifestyle',
  'books',
  'food',
  'travel',
  'gaming',
] as const;
export const COMMUNITY_VISIBILITIES = ['open', 'private'] as const;
export const MEMBER_ROLES = ['owner', 'moderator', 'member'] as const;
export const MEMBER_STATUSES = ['active', 'pending', 'banned'] as const;
export const POST_KINDS = ['text', 'photo', 'video', 'reel'] as const;
export const MEDIA_PURPOSES = ['avatar', 'post', 'story'] as const;

export const MEDIA_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  imageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  videoTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  postMediaMax: 6,
} as const;

/** Stories disappear after this long. */
export const STORY_TTL_HOURS = 24;

/** Group-room tickets may be priced up to this far above the plan's published reference. */
export const DEFAULT_TICKET_CAP_BPS = 1000;

/**
 * Entitlements the code checks for. Plans can carry other catalogue features for display,
 * but only these keys change runtime behaviour.
 */
export const FEATURE = {
  analyticsDetailed: 'analytics_detailed',
  analyticsAdvanced: 'analytics_advanced',
  discoveryEnhanced: 'discovery_enhanced',
  discoveryPriority: 'discovery_priority',
  activitiesBasic: 'activities_basic',
  activitiesExtended: 'activities_extended',
  activitiesAdvanced: 'activities_advanced',
} as const;

export const ERROR_CODES = [
  'bad_request',
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'internal_error',
  'account_suspended',
  'onboarding_required',
  'host_verification_required',
  'host_application_exists',
  'host_name_taken',
  'room_not_open',
  'room_full',
  'own_room',
  'already_applied',
  'application_not_payable',
  'application_not_pending',
  'plan_unavailable',
  'capacity_below_seats_taken',
  'payment_invalid',
  'payment_provider_error',
  'room_unbalanced',
  'invite_code_required',
  'ticket_above_cap',
  'message_blocked',
  'content_blocked',
  'muted',
  'not_a_member',
  'reveal_exists',
  'feature_not_in_plan',
  'already_rated',
  'room_not_ended',
  'community_name_taken',
  'display_name_taken',
  'media_invalid',
  'storage_unavailable',
] as const;

/** Ready-made activities a host can launch with one tap. */
export const ACTIVITY_LIBRARY: {
  kind: (typeof ACTIVITY_KINDS)[number];
  title: string;
  options: string[];
}[] = [
  { kind: 'prompt', title: 'What is a small thing that made you smile this week?', options: [] },
  { kind: 'prompt', title: 'Describe your perfect Sunday in three words.', options: [] },
  { kind: 'prompt', title: 'What is a hill you are willing to die on?', options: [] },
  { kind: 'prompt', title: 'Which song would play when you walk into a room?', options: [] },
  { kind: 'this_or_that', title: 'Mountains or beaches?', options: ['Mountains', 'Beaches'] },
  { kind: 'this_or_that', title: 'Chai or coffee?', options: ['Chai', 'Coffee'] },
  {
    kind: 'this_or_that',
    title: 'Plan everything or go with the flow?',
    options: ['Plan', 'Flow'],
  },
  { kind: 'this_or_that', title: 'Early bird or night owl?', options: ['Early bird', 'Night owl'] },
  {
    kind: 'poll',
    title: 'Ideal first date?',
    options: ['Street food walk', 'Bookstore and coffee', 'Live music', 'Cooking together'],
  },
  {
    kind: 'poll',
    title: 'What matters most in a partner?',
    options: ['Humour', 'Kindness', 'Ambition', 'Curiosity'],
  },
  {
    kind: 'poll',
    title: 'Weekend getaway?',
    options: ['Hill station', 'Beach town', 'Heritage city', 'Stay home, phone off'],
  },
  {
    kind: 'intro_round',
    title: 'Introductions: two truths and a lie',
    options: [],
  },
  {
    kind: 'intro_round',
    title: 'Introductions: what you do for fun, what you are learning, what you are looking for',
    options: [],
  },
];
