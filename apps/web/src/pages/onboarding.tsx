import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { GENDERS, INTERESTS, onboardingInput } from '@reomi/shared';
import type { OnboardingInput } from '@reomi/shared';
import { Button, ErrorNotice, Field, Input, Select } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';
import { safeNext } from '../lib/guards';
import { GENDER_LABELS, INTEREST_LABELS } from '../lib/labels';

export const OnboardingPage = () => {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const next = safeNext(params.get('next'));

  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingInput),
    defaultValues: { fullName: '', dateOfBirth: '', gender: 'woman', interestedIn: [] },
  });

  const save = useMutation({
    mutationFn: (values: OnboardingInput) => api.put('/v1/me/profile', values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      await navigate(next, { replace: true });
    },
  });

  if (me?.onboarded && !save.isPending) return <Navigate to={next} replace />;

  const { errors } = form.formState;

  return (
    <div className="mx-auto max-w-md py-6">
      <h1 className="font-display text-4xl">A little about you</h1>
      <p className="mt-2 text-muted">
        This stays private. Rooms only ever see an alias, plus your gender and who you want to meet
        so hosts can keep rooms balanced.
      </p>

      <form
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        className="mt-8 space-y-5"
      >
        <Field
          label="Full name"
          error={errors.fullName?.message}
          hint="Shown only if you and someone else both choose to reveal."
        >
          <Input autoComplete="name" {...form.register('fullName')} />
        </Field>

        <Field
          label="Date of birth"
          error={errors.dateOfBirth?.message}
          hint="You must be 18 or older."
        >
          <Input type="date" autoComplete="bday" {...form.register('dateOfBirth')} />
        </Field>

        <Field label="I am" error={errors.gender?.message}>
          <Select {...form.register('gender')}>
            {GENDERS.map((value) => (
              <option key={value} value={value}>
                {GENDER_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        <Controller
          control={form.control}
          name="interestedIn"
          render={({ field }) => (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">I want to meet</legend>
              <div className="flex flex-wrap gap-2">
                {INTERESTS.map((value) => {
                  const checked = field.value.includes(value);
                  return (
                    <label
                      key={value}
                      className={`flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-sm transition-colors has-focus-visible:outline-2 has-focus-visible:outline-amber ${
                        checked
                          ? 'border-cream bg-cream text-ink'
                          : 'border-line text-muted hover:text-cream'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={checked}
                        onChange={() =>
                          field.onChange(
                            checked
                              ? field.value.filter((entry) => entry !== value)
                              : [...field.value, value],
                          )
                        }
                      />
                      {INTEREST_LABELS[value]}
                    </label>
                  );
                })}
              </div>
              {errors.interestedIn && (
                <p className="mt-1.5 text-sm text-danger">{errors.interestedIn.message}</p>
              )}
            </fieldset>
          )}
        />

        {save.isError && <ErrorNotice error={save.error} />}
        <Button type="submit" className="w-full" loading={save.isPending}>
          Continue
        </Button>
      </form>
    </div>
  );
};
