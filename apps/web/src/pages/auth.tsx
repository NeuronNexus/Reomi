import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { Button, ErrorNotice, Field, Input } from '../components/ui';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/client';
import { safeNext } from '../lib/guards';

const credentials = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters'),
});

const emailOnly = credentials.pick({ email: true });
const passwordOnly = credentials.pick({ password: true });

const AuthCard = ({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) => (
  <div className="mx-auto max-w-md py-6">
    <h1 className="font-display text-4xl">{title}</h1>
    {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
    <div className="mt-8">{children}</div>
    {footer && <p className="mt-6 text-sm text-muted">{footer}</p>}
  </div>
);

const useRedirectWhenSignedIn = () => {
  const { session } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  useEffect(() => {
    if (session) void navigate(next, { replace: true });
  }, [session, next, navigate]);
  return next;
};

export const LoginPage = () => {
  const next = useRedirectWhenSignedIn();
  const [error, setError] = useState<Error | null>(null);
  const form = useForm({
    resolver: zodResolver(credentials),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { error: failure } = await supabase.auth.signInWithPassword(values);
    if (failure) setError(failure);
  });

  return (
    <AuthCard
      title="Welcome back"
      footer={
        <>
          New here?{' '}
          <Link
            to={`/signup?next=${encodeURIComponent(next)}`}
            className="text-cream underline underline-offset-4"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </Field>
        {error && <ErrorNotice error={error} />}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Sign in
        </Button>
        <Link
          to="/forgot-password"
          className="block text-center text-sm text-muted hover:text-cream"
        >
          Forgot your password?
        </Link>
      </form>
    </AuthCard>
  );
};

export const SignupPage = () => {
  const next = useRedirectWhenSignedIn();
  const [error, setError] = useState<Error | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm({
    resolver: zodResolver(credentials),
    defaultValues: { email: '', password: '' },
  });

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    const { data, error: failure } = await supabase.auth.signUp({
      ...values,
      options: { emailRedirectTo: `${window.location.origin}/onboarding` },
    });
    if (failure) setError(failure);
    // With email confirmation on, Supabase returns no session until the link is clicked.
    else if (!data.session) setSentTo(values.email);
  });

  if (sentTo) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle={`We sent a confirmation link to ${sentTo}. Open it to finish signing up.`}
      >
        <span />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Join the room"
      subtitle="Your email stays private. Nobody in a room ever sees it."
      footer={
        <>
          Already have an account?{' '}
          <Link
            to={`/login?next=${encodeURIComponent(next)}`}
            className="text-cream underline underline-offset-4"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        {error && <ErrorNotice error={error} />}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
};

export const ForgotPasswordPage = () => {
  const [sent, setSent] = useState(false);
  const form = useForm({ resolver: zodResolver(emailOnly), defaultValues: { email: '' } });

  const submit = form.handleSubmit(async ({ email }) => {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Same message either way, so this form cannot reveal who has an account.
    setSent(true);
  });

  if (sent) {
    return (
      <AuthCard
        title="Check your inbox"
        subtitle="If that email has an account, a reset link is on its way."
      >
        <span />
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Reset your password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </Field>
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
    </AuthCard>
  );
};

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<Error | null>(null);
  const form = useForm({ resolver: zodResolver(passwordOnly), defaultValues: { password: '' } });

  const submit = form.handleSubmit(async ({ password }) => {
    const { error: failure } = await supabase.auth.updateUser({ password });
    if (failure) {
      setError(failure);
      return;
    }
    toast.success('Password updated');
    await navigate('/');
  });

  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </Field>
        {error && <ErrorNotice error={error} />}
        <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </AuthCard>
  );
};
