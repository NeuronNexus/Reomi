import clsx from 'clsx';
import { LoaderCircle, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, Ref } from 'react';

type Variant = 'primary' | 'default' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export const Button = ({
  variant = 'default',
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={clsx(
      'inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors',
      'disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'primary' && 'bg-ink text-white hover:bg-ink/85',
      variant === 'default' && 'border border-line bg-panel hover:bg-page',
      variant === 'danger' && 'border border-bad/30 bg-panel text-bad hover:bg-bad-soft',
      className,
    )}
    {...rest}
  >
    {loading && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
    {children}
  </button>
);

/** Asks for a second click rather than a blocking browser dialog. */
export const ConfirmButton = ({
  onConfirm,
  children,
  confirmLabel = 'Click to confirm',
  ...rest
}: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; confirmLabel?: string }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  return (
    <Button
      {...rest}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  );
};

const inputClass =
  'h-9 w-full rounded-md border border-line bg-panel px-2.5 text-sm focus:border-accent focus:outline-none';

export const Input = ({
  className,
  ref,
  ...rest
}: ComponentProps<'input'> & { ref?: Ref<HTMLInputElement> }) => (
  <input ref={ref} className={clsx(inputClass, className)} {...rest} />
);

export const Select = ({
  className,
  ref,
  ...rest
}: ComponentProps<'select'> & { ref?: Ref<HTMLSelectElement> }) => (
  <select ref={ref} className={clsx(inputClass, className)} {...rest} />
);

export const Textarea = ({
  className,
  ref,
  ...rest
}: ComponentProps<'textarea'> & { ref?: Ref<HTMLTextAreaElement> }) => (
  <textarea ref={ref} className={clsx(inputClass, 'h-auto min-h-20 py-2', className)} {...rest} />
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
    <span className="mb-1 block text-[13px] font-medium">{label}</span>
    {children}
    {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    {error && <span className="mt-1 block text-xs text-bad">{error}</span>}
  </label>
);

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

export const Pill = ({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) => (
  <span
    className={clsx(
      'inline-flex rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap',
      tone === 'neutral' && 'bg-page text-muted',
      tone === 'good' && 'bg-good-soft text-good',
      tone === 'warn' && 'bg-warn-soft text-warn',
      tone === 'bad' && 'bg-bad-soft text-bad',
      tone === 'accent' && 'bg-accent-soft text-accent',
    )}
  >
    {children}
  </span>
);

export const PageHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <header className="mb-5">
    <h1 className="text-xl font-semibold">{title}</h1>
    {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
  </header>
);

export const Panel = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={clsx('rounded-lg border border-line bg-panel', className)}>
    {children}
  </section>
);

export const Toolbar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">{children}</div>
);

export const SearchBox = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) => (
  <div className="relative w-full sm:w-64">
    <Search
      className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted"
      aria-hidden
    />
    <Input
      type="search"
      aria-label={placeholder}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="pl-8!"
    />
  </div>
);

export const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line text-xs text-muted">
          {head.map((label, index) => (
            <th
              key={label || index}
              scope="col"
              className="px-3 py-2 font-medium whitespace-nowrap"
            >
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">{children}</tbody>
    </table>
  </div>
);

export const Cell = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={clsx('px-3 py-2.5 align-middle', className)}>{children}</td>
);

export const TableState = ({
  isPending,
  error,
  isEmpty,
  emptyLabel,
}: {
  isPending: boolean;
  error: Error | null;
  isEmpty: boolean;
  emptyLabel: string;
}) => {
  if (isPending) {
    return (
      <div role="status" className="grid place-items-center py-12 text-muted">
        <LoaderCircle className="size-5 animate-spin" aria-hidden />
        <span className="sr-only">Loading</span>
      </div>
    );
  }
  if (error) return <p className="p-4 text-bad">{error.message}</p>;
  if (isEmpty) return <p className="p-8 text-center text-muted">{emptyLabel}</p>;
  return null;
};

export const Pager = ({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) => {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <div className="flex items-center justify-between border-t border-line p-3 text-muted">
      <span>{total.toLocaleString('en-IN')} total</span>
      <div className="flex items-center gap-2">
        <Button disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </Button>
        <span>
          {page} / {pages}
        </span>
        <Button disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
};

export const Modal = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-panel shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
};
