import type { GENDERS, INTERESTS, ROOM_CATEGORIES } from '@reomi/shared';

export type Gender = (typeof GENDERS)[number];
export type Interest = (typeof INTERESTS)[number];
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<RoomCategory, string> = {
  dating: 'Dating',
  friends: 'Friends',
  hobbies: 'Hobbies',
  personality: 'Personality',
  small_group: 'Small group',
};

export const GENDER_LABELS: Record<Gender, string> = {
  woman: 'Woman',
  man: 'Man',
  non_binary: 'Non-binary',
  other: 'Prefer to self-describe',
};

export const INTEREST_LABELS: Record<Interest, string> = {
  women: 'Women',
  men: 'Men',
  non_binary: 'Non-binary people',
};
