import { eq } from 'drizzle-orm';
import type { Me, ProfileInput } from '@reomi/shared';
import { profiles } from '../db/schema';
import { isOnboarded } from '../plugins/auth';
import type { AuthContext } from '../plugins/auth';
import type { Ctx } from './common';
import { iso } from './common';
import { claimMedia, signPaths } from './media.service';
import { strikesFor } from './moderation.service';

export const toMe = async (ctx: Ctx, { profile, host }: AuthContext): Promise<Me> => {
  const [avatars, strikes] = await Promise.all([
    signPaths(ctx, [profile.avatarPath]),
    strikesFor(ctx, profile.id),
  ]);
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    dateOfBirth: profile.dateOfBirth,
    gender: profile.gender,
    interestedIn: profile.interestedIn as Me['interestedIn'],
    bio: profile.bio,
    city: profile.city,
    avatarUrl: profile.avatarPath ? (avatars.get(profile.avatarPath) ?? null) : null,
    role: profile.role,
    onboarded: isOnboarded(profile),
    mutedUntil:
      profile.mutedUntil && profile.mutedUntil > new Date() ? iso(profile.mutedUntil) : null,
    strikes,
    host: host
      ? { status: host.status, displayName: host.displayName, reviewNote: host.reviewNote }
      : null,
  };
};

export const updateOnboarding = async (
  ctx: Pick<Ctx, 'db'>,
  userId: string,
  input: Pick<typeof profiles.$inferInsert, 'fullName' | 'dateOfBirth' | 'gender' | 'interestedIn'>,
) => {
  await ctx.db.update(profiles).set(input).where(eq(profiles.id, userId));
};

export const updateProfile = async (ctx: Ctx, userId: string, input: ProfileInput) => {
  await ctx.db.transaction(async (tx) => {
    let avatarPath: string | null | undefined;
    if (input.avatarMediaId === null) avatarPath = null;
    else if (input.avatarMediaId) {
      const [file] = await claimMedia(tx, userId, [input.avatarMediaId], 'avatar');
      avatarPath = file!.path;
    }
    await tx
      .update(profiles)
      .set({
        fullName: input.fullName,
        bio: input.bio,
        city: input.city,
        interestedIn: input.interestedIn,
        ...(avatarPath !== undefined ? { avatarPath } : {}),
      })
      .where(eq(profiles.id, userId));
  });
};
