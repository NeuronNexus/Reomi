import type { COMMUNITY_TOPICS, GENDERS, INTERESTS, ROOM_CATEGORIES } from '@reomi/shared';

export type Gender = (typeof GENDERS)[number];
export type Interest = (typeof INTERESTS)[number];
export type RoomCategory = (typeof ROOM_CATEGORIES)[number];
export type CommunityTopic = (typeof COMMUNITY_TOPICS)[number];

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
  non_binary: 'Non-binary and gender-diverse people',
};

export const TOPIC_LABELS: Record<CommunityTopic, string> = {
  fashion: 'Fashion and styling',
  fitness: 'Fitness and sport',
  art: 'Art, photo and design',
  music: 'Music and entertainment',
  tech: 'Tech and programming',
  lifestyle: 'Lifestyle',
  books: 'Books',
  food: 'Food',
  travel: 'Travel',
  gaming: 'Gaming',
};

export const STAGE_LABELS = {
  connection: 'We connected',
  talking: 'We are talking',
  relationship: 'We are seeing each other',
} as const;
