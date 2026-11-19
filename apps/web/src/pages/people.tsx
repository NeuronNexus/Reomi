import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, ShieldAlert, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { INTERESTS, profileInput } from '@reomi/shared';
import type { Follow, ProfileInput, Reveal } from '@reomi/shared';
import { AuraAvatar } from '../components/aura';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  LinkButton,
  PageTitle,
  Spinner,
  Textarea,
} from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { shortDate } from '../lib/format';
import { INTEREST_LABELS } from '../lib/labels';
import { ACCEPT_IMAGES, toastError, uploadFile } from '../lib/upload';
import { RevealItem } from './space';

export const ConnectionsPage = () => {
  const connections = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get<Reveal[]>('/v1/me/connections'),
  });
  const following = useQuery({
    queryKey: ['following'],
    queryFn: () => api.get<Follow[]>('/v1/me/following'),
  });

  const accepted = connections.data?.filter((r) => r.status === 'accepted') ?? [];
  const pending = connections.data?.filter((r) => r.status === 'pending') ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Reveals"
        subtitle="People you chose to show yourself to, and who chose you back. Only mutual reveals show a real profile."
      />
      {connections.isPending && <Spinner />}
      {connections.isError && <ErrorNotice error={connections.error} />}
      {connections.data?.length === 0 && (
        <EmptyState
          title="No reveals yet"
          body="Inside a room, tap the heart next to someone's alias. If they say yes too, you both see each other here."
          action={<LinkButton to="/">Find a room</LinkButton>}
        />
      )}
      {pending.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-2xl">Waiting</h2>
          <ul className="space-y-3">
            {pending.map((reveal) => (
              <div key={reveal.id}>
                <p className="mb-1 text-xs text-faint">In {reveal.roomTitle}</p>
                <RevealItem reveal={reveal} />
              </div>
            ))}
          </ul>
        </section>
      )}
      {accepted.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 font-display text-2xl">Mutual</h2>
          <ul className="grid gap-4 md:grid-cols-2">
            {accepted.map((reveal) => (
              <div key={reveal.id}>
                <p className="mb-1 text-xs text-faint">Met in {reveal.roomTitle}</p>
                <RevealItem reveal={reveal} />
              </div>
            ))}
          </ul>
        </section>
      )}
      {following.data && following.data.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Following</h2>
          <ul className="flex flex-wrap gap-3">
            {following.data.map((person) => (
              <li key={person.id}>
                <Link
                  to={person.kind === 'host' ? `/hosts/${person.id}` : '/connections'}
                  className="flex items-center gap-2 rounded-full border border-line py-1 pr-4 pl-1 hover:border-faint"
                >
                  {person.avatarUrl ? (
                    <img
                      src={person.avatarUrl}
                      alt=""
                      className="size-8 rounded-full object-cover"
                    />
                  ) : (
                    <span className="scale-80">
                      <AuraAvatar seed={person.name} />
                    </span>
                  )}
                  <span className="text-sm">{person.name}</span>
                  <span className="text-xs text-faint">
                    {person.kind === 'host' ? 'Host' : 'Connection'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export const ProfilePage = () => {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarMediaId, setAvatarMediaId] = useState<string | null | undefined>(undefined);
  const [uploading, setUploading] = useState(false);

  const form = useForm<z.input<typeof profileInput>, unknown, ProfileInput>({
    resolver: zodResolver(profileInput),
    values: me
      ? { fullName: me.fullName ?? '', bio: me.bio, city: me.city, interestedIn: me.interestedIn }
      : undefined,
  });

  const save = useMutation({
    mutationFn: (values: ProfileInput) =>
      api.put('/v1/me/details', {
        ...values,
        ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
      }),
    onSuccess: async () => {
      toast.success('Profile saved');
      setAvatarMediaId(undefined);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: toastError,
  });

  if (!me) return <Spinner />;
  const { errors } = form.formState;
  const avatar = preview ?? (avatarMediaId === null ? null : me.avatarUrl);
  const interested = form.watch('interestedIn') ?? [];

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const id = await uploadFile(file, 'avatar');
      setAvatarMediaId(id);
      setPreview(URL.createObjectURL(file));
    } catch (error) {
      toastError(error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle
        title="Your profile"
        subtitle="This is what someone sees only after you both agree to reveal. Rooms only ever show your alias."
      />

      {me.mutedUntil && (
        <p className="mb-6 flex gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          You are muted until {shortDate(me.mutedUntil)} after moderation strikes.
        </p>
      )}
      {me.strikes > 0 && !me.mutedUntil && (
        <p className="mb-6 rounded-xl bg-raised p-3 text-sm text-muted">
          You have {me.strikes} moderation strike{me.strikes === 1 ? '' : 's'} in the last 30 days.
        </p>
      )}

      <div className="mb-8 flex items-center gap-5">
        <div className="relative">
          {avatar ? (
            <img src={avatar} alt="Your photo" className="size-24 rounded-full object-cover" />
          ) : (
            <span className="inline-block size-24 overflow-hidden rounded-full">
              <span className="block scale-[2.4] origin-top-left">
                <AuraAvatar seed={me.id} />
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT_IMAGES}
            className="hidden"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <Button variant="ghost" loading={uploading} onClick={() => fileInput.current?.click()}>
            <Camera className="size-4" aria-hidden />
            {avatar ? 'Change photo' : 'Add photo'}
          </Button>
          {avatar && (
            <Button
              variant="quiet"
              onClick={() => {
                setPreview(null);
                setAvatarMediaId(null);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Remove
            </Button>
          )}
        </div>
      </div>

      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-5">
        <Field label="Full name" error={errors.fullName?.message}>
          <Input {...form.register('fullName')} />
        </Field>
        <Field label="City" error={errors.city?.message}>
          <Input placeholder="Optional" {...form.register('city')} />
        </Field>
        <Field label="About you" error={errors.bio?.message} hint="Up to 300 characters.">
          <Textarea maxLength={300} {...form.register('bio')} />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">I want to meet</legend>
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map((value) => {
              const on = interested.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    form.setValue(
                      'interestedIn',
                      on ? interested.filter((v) => v !== value) : [...interested, value],
                      { shouldDirty: true },
                    )
                  }
                  className={
                    on
                      ? 'min-h-10 rounded-full border border-amber bg-ember/15 px-4 text-sm text-amber'
                      : 'min-h-10 rounded-full border border-line px-4 text-sm text-muted'
                  }
                >
                  {INTEREST_LABELS[value]}
                </button>
              );
            })}
          </div>
          {errors.interestedIn && <p className="mt-1.5 text-sm text-danger">Choose at least one</p>}
          <p className="mt-1.5 text-sm text-faint">Rooms use this to keep things balanced.</p>
        </fieldset>
        <Button type="submit" loading={save.isPending} disabled={uploading}>
          Save profile
        </Button>
      </form>

      <section className="mt-12 rounded-2xl border border-line p-5 text-sm text-muted">
        <h2 className="font-medium text-cream">Account</h2>
        <p className="mt-1">Signed in as {me.email}. Your email is never shown to anyone.</p>
      </section>
    </div>
  );
};
