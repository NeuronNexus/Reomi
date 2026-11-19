export const APP_NAME = 'Reomi';
export const MINIMUM_AGE = 18;
export const CURRENCY = 'INR';

export const GENDERS = ['woman', 'man', 'non_binary', 'other'] as const;
export const INTERESTS = ['women', 'men', 'non_binary'] as const;

export const ROOM_CATEGORIES = [
  'dating',
  'friends',
  'hobbies',
  'personality',
  'small_group',
] as const;

export const ROOM_STATUSES = ['pending_payment', 'open', 'closed'] as const;

/** Stored application states. `expired` is derived, see APPLICATION_VIEW_STATUSES. */
export const APPLICATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
  'joined',
] as const;

/** What clients see: an `accepted` application past its payment deadline reads as `expired`. */
export const APPLICATION_VIEW_STATUSES = [...APPLICATION_STATUSES, 'expired'] as const;

export const HOST_STATUSES = ['pending', 'verified', 'rejected', 'revoked'] as const;
export const USER_ROLES = ['user', 'admin'] as const;
export const USER_STATUSES = ['active', 'suspended'] as const;

export const PAYMENT_PURPOSES = ['host_plan', 'room_ticket'] as const;
export const PAYMENT_STATUSES = ['created', 'paid', 'refund_required', 'refunded'] as const;
export const PAYMENT_PROVIDERS = ['razorpay', 'mock'] as const;

/**
 * Entitlements the code checks for. Plans can carry other catalogue features for display,
 * but only these keys change runtime behaviour.
 */
export const FEATURE = {
  analyticsDetailed: 'analytics_detailed',
  analyticsAdvanced: 'analytics_advanced',
  discoveryEnhanced: 'discovery_enhanced',
  discoveryPriority: 'discovery_priority',
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
] as const;
