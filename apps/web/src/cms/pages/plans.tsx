import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { adminFeatureInput, adminPlanInput, formatPaise } from '@reomi/shared';
import type { AdminFeatureInput, AdminPlan, Feature } from '@reomi/shared';
import { Button, Field, Input, Modal, PageHeader, Panel, Pill, TableState } from '../ui';
import { api } from '../../lib/client';

/* The form works in rupees and percent; the API stores paise and basis points. */
const planForm = adminPlanInput
  .omit({
    pricePaise: true,
    platformFeeBps: true,
    durationDays: true,
    capacity: true,
    sortOrder: true,
  })
  .extend({
    priceRupees: z.coerce.number<string>().min(1, 'At least ₹1'),
    feePercent: z.coerce.number<string>().min(0).max(100, 'At most 100%'),
    durationDays: z.coerce.number<string>().int().min(1).max(365),
    capacity: z.coerce.number<string>().int().min(2).max(10_000),
    sortOrder: z.coerce.number<string>().int().min(0).max(1000),
  });

type PlanFormInput = z.input<typeof planForm>;
type PlanFormValues = z.output<typeof planForm>;

const toPayload = ({ priceRupees, feePercent, ...values }: PlanFormValues) => ({
  ...values,
  pricePaise: Math.round(priceRupees * 100),
  platformFeeBps: Math.round(feePercent * 100),
});

export const PlansPage = () => {
  const [editing, setEditing] = useState<AdminPlan | 'new' | null>(null);
  const [addingFeature, setAddingFeature] = useState(false);

  const plans = useQuery({
    queryKey: ['admin-plans'],
    queryFn: () => api.get<AdminPlan[]>('/v1/admin/plans'),
  });
  const features = useQuery({
    queryKey: ['admin-features'],
    queryFn: () => api.get<Feature[]>('/v1/admin/features'),
  });

  return (
    <>
      <PageHeader
        title="Plans & features"
        subtitle="Changes apply to rooms created from now on. Existing rooms keep the terms their host paid for."
      />

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Plans</h2>
        <Button onClick={() => setEditing('new')}>
          <Plus className="size-3.5" aria-hidden />
          New plan
        </Button>
      </div>
      <TableState isPending={plans.isPending} error={plans.error} isEmpty={false} emptyLabel="" />
      <div className="mb-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {plans.data?.map((plan) => (
          <Panel key={plan.id} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{plan.name}</h3>
                <p className="text-muted">{plan.description}</p>
              </div>
              {plan.isActive ? <Pill tone="good">active</Pill> : <Pill>hidden</Pill>}
            </div>
            <p className="mt-3 text-2xl font-semibold tabular-nums">
              {formatPaise(plan.pricePaise)}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted">Duration</dt>
              <dd className="text-right">{plan.durationDays} days</dd>
              <dt className="text-muted">Capacity</dt>
              <dd className="text-right">{plan.capacity} people</dd>
              <dt className="text-muted">Ticket commission</dt>
              <dd className="text-right">{plan.platformFeeBps / 100}%</dd>
              <dt className="text-muted">Rooms on this plan</dt>
              <dd className="text-right">{plan.roomCount}</dd>
            </dl>
            <Button className="mt-3 w-full" onClick={() => setEditing(plan)}>
              Edit plan
            </Button>
          </Panel>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-medium">Features by plan</h2>
        <Button onClick={() => setAddingFeature(true)}>
          <Plus className="size-3.5" aria-hidden />
          New feature
        </Button>
      </div>
      {plans.data && features.data && <FeatureMatrix plans={plans.data} features={features.data} />}

      {editing && (
        <PlanEditor plan={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {addingFeature && <FeatureEditor onClose={() => setAddingFeature(false)} />}
    </>
  );
};

const FeatureMatrix = ({ plans, features }: { plans: AdminPlan[]; features: Feature[] }) => {
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: ({ plan, key, on }: { plan: AdminPlan; key: string; on: boolean }) => {
      const current = plan.features.map((feature) => feature.key);
      return api.put(`/v1/admin/plans/${plan.id}/features`, {
        featureKeys: on ? [...current, key] : current.filter((entry) => entry !== key),
      });
    },
    // The box flips straight away and rolls back if the save fails.
    onMutate: async ({ plan, key, on }) => {
      await queryClient.cancelQueries({ queryKey: ['admin-plans'] });
      const previous = queryClient.getQueryData<AdminPlan[]>(['admin-plans']);
      const feature = features.find((entry) => entry.key === key);
      queryClient.setQueryData<AdminPlan[]>(['admin-plans'], (current) =>
        current?.map((entry) => {
          if (entry.id !== plan.id) return entry;
          const others = entry.features.filter((item) => item.key !== key);
          return { ...entry, features: on && feature ? [...others, feature] : others };
        }),
      );
      return { previous };
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(['admin-plans'], context?.previous);
      toast.error(error.message);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin-plans'] }),
  });

  const setLive = useMutation({
    mutationFn: ({ key, isLive }: { key: string; isLive: boolean }) =>
      api.patch(`/v1/admin/features/${key}`, { isLive }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (error) => toast.error(error.message),
  });

  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                Feature
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Availability
              </th>
              {plans.map((plan) => (
                <th key={plan.id} scope="col" className="px-3 py-2 text-center font-medium">
                  {plan.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {features.map((feature) => (
              <tr key={feature.key}>
                <th scope="row" className="px-3 py-2.5 text-left font-normal">
                  <p className="font-medium">{feature.name}</p>
                  <p className="text-muted">{feature.description}</p>
                </th>
                <td className="px-3 py-2.5">
                  <button
                    type="button"
                    title="Toggle whether this is sold as live or shown as coming soon"
                    onClick={() => setLive.mutate({ key: feature.key, isLive: !feature.isLive })}
                  >
                    {feature.isLive ? (
                      <Pill tone="good">live</Pill>
                    ) : (
                      <Pill tone="warn">coming soon</Pill>
                    )}
                  </button>
                </td>
                {plans.map((plan) => {
                  const on = plan.features.some((entry) => entry.key === feature.key);
                  return (
                    <td key={plan.id} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        aria-label={`${feature.name} on ${plan.name}`}
                        checked={on}
                        disabled={toggle.isPending}
                        onChange={() => toggle.mutate({ plan, key: feature.key, on: !on })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
};

const PlanEditor = ({ plan, onClose }: { plan: AdminPlan | null; onClose: () => void }) => {
  const queryClient = useQueryClient();
  const form = useForm<PlanFormInput, unknown, PlanFormValues>({
    resolver: zodResolver(planForm),
    defaultValues: {
      slug: plan?.slug ?? '',
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      priceRupees: plan ? String(plan.pricePaise / 100) : '',
      feePercent: plan ? String(plan.platformFeeBps / 100) : '10',
      durationDays: plan ? String(plan.durationDays) : '',
      capacity: plan ? String(plan.capacity) : '',
      sortOrder: plan ? String(plan.sortOrder) : '100',
      isActive: plan?.isActive ?? true,
    },
  });

  const save = useMutation({
    mutationFn: (values: PlanFormValues) =>
      plan
        ? api.patch(`/v1/admin/plans/${plan.id}`, toPayload(values))
        : api.post('/v1/admin/plans', toPayload(values)),
    onSuccess: async () => {
      toast.success('Plan saved');
      await queryClient.invalidateQueries({ queryKey: ['admin-plans'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const { errors } = form.formState;

  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose}>
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={errors.name?.message}>
            <Input {...form.register('name')} />
          </Field>
          <Field label="Slug" error={errors.slug?.message}>
            <Input {...form.register('slug')} />
          </Field>
        </div>
        <Field label="Description" error={errors.description?.message}>
          <Input {...form.register('description')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Price (₹)" error={errors.priceRupees?.message}>
            <Input type="number" step="0.01" {...form.register('priceRupees')} />
          </Field>
          <Field label="Ticket commission (%)" error={errors.feePercent?.message}>
            <Input type="number" step="0.01" {...form.register('feePercent')} />
          </Field>
          <Field label="Duration (days)" error={errors.durationDays?.message}>
            <Input type="number" {...form.register('durationDays')} />
          </Field>
          <Field label="Capacity (people)" error={errors.capacity?.message}>
            <Input type="number" {...form.register('capacity')} />
          </Field>
          <Field label="Display order" error={errors.sortOrder?.message}>
            <Input type="number" {...form.register('sortOrder')} />
          </Field>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-accent" {...form.register('isActive')} />
          Available to hosts
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save plan
          </Button>
        </div>
      </form>
    </Modal>
  );
};

const FeatureEditor = ({ onClose }: { onClose: () => void }) => {
  const queryClient = useQueryClient();
  const form = useForm<AdminFeatureInput>({
    resolver: zodResolver(adminFeatureInput),
    defaultValues: { key: '', name: '', description: '', isLive: false, sortOrder: 100 },
  });

  const save = useMutation({
    mutationFn: (values: AdminFeatureInput) => api.post('/v1/admin/features', values),
    onSuccess: async () => {
      toast.success('Feature added');
      await queryClient.invalidateQueries({ queryKey: ['admin-features'] });
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const { errors } = form.formState;

  return (
    <Modal title="New feature" onClose={onClose}>
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} className="space-y-3">
        <Field
          label="Key"
          error={errors.key?.message}
          hint="A new key is shown on plan cards. It only changes app behaviour once developers build it."
        >
          <Input placeholder="custom_badge" {...form.register('key')} />
        </Field>
        <Field label="Name" error={errors.name?.message}>
          <Input {...form.register('name')} />
        </Field>
        <Field label="Description" error={errors.description?.message}>
          <Input {...form.register('description')} />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4 accent-accent" {...form.register('isLive')} />
          Already available (otherwise shown as coming soon)
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={save.isPending}>
            Add feature
          </Button>
        </div>
      </form>
    </Modal>
  );
};
