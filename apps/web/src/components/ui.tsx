import clsx from 'clsx';
import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, Ref } from 'react';
import { Link } from 'react-router';

type Variant = 'primary' | 'ghost' | 'quiet' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ember text-ink hover:bg-amber font-semibold',
  ghost: 'border border-line text-cream hover:border-faint hover:bg-raised',
  quiet: 'text-muted hover:text-cream',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

const buttonClass = (variant: Variant, className?: string) =>
  clsx(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm transition-colors',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANTS[variant],
    className,
  );

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export const Button = ({
  variant = 'primary',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={buttonClass(variant, className)}
    disabled={disabled || loading}
    {...rest}
  >
    {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
    {children}
  </button>
);

export const LinkButton = ({
  variant = 'primary',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant }) => (
  <Link className={buttonClass(variant, className)} {...rest} />
);

const fieldClass =
  'w-full rounded-xl border border-line bg-surface px-4 py-3 text-base text-cream ' +
  'placeholder:text-faint focus:border-amber focus:outline-none';

export const Input = ({
  className,
  ref,
  ...rest
}: ComponentProps<'input'> & { ref?: Ref<HTMLInputElement> }) => (
  <input ref={ref} className={clsx(fieldClass, className)} {...rest} />
);

export const Textarea = ({
  className,
  ref,
  ...rest
}: ComponentProps<'textarea'> & { ref?: Ref<HTMLTextAreaElement> }) => (
  <textarea ref={ref} className={clsx(fieldClass, 'min-h-28 resize-y', className)} {...rest} />
);

export const Select = ({
  className,
  ref,
  ...rest
}: ComponentProps<'select'> & { ref?: Ref<HTMLSelectElement> }) => (
  <select ref={ref} className={clsx(fieldClass, className)} {...rest} />
);

export const Field = ({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}) => (
  <label className="block">
    <span className="mb-1.5 block text-sm font-medium">{label}</span>
    {children}
    {hint && !error && <span className="mt-1.5 block text-sm text-faint">{hint}</span>}
    {error && <span className="mt-1.5 block text-sm text-danger">{error}</span>}
  </label>
);

export const Badge = ({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ember' | 'success' | 'danger';
  children: ReactNode;
}) => (
  <span
    className={clsx(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'neutral' && 'bg-raised text-muted',
      tone === 'ember' && 'bg-ember/15 text-amber',
      tone === 'success' && 'bg-success/15 text-success',
      tone === 'danger' && 'bg-danger/15 text-danger',
    )}
  >
    {children}
  </span>
);

export const Spinner = ({ label = 'Loading' }: { label?: string }) => (
  <div role="status" className="grid place-items-center py-24 text-faint">
    <LoaderCircle className="size-6 animate-spin" aria-hidden />
    <span className="sr-only">{label}</span>
  </div>
);

export const EmptyState = ({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) => (
  <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
    <h2 className="font-display text-2xl">{title}</h2>
    {body && <p className="mx-auto mt-2 max-w-md text-muted">{body}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);

export const ErrorNotice = ({ error }: { error: unknown }) => (
  <p role="alert" className="rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
    {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
  </p>
);

export const PageTitle = ({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) => (
  <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
    <div>
      <h1 className="font-display text-4xl leading-tight md:text-5xl">{title}</h1>
      {subtitle && <p className="mt-2 max-w-xl text-muted">{subtitle}</p>}
    </div>
    {action}
  </header>
);
