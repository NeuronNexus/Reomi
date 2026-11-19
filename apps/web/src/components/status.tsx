import type { MyApplication } from '@agnipath/shared';
import { Badge } from './ui';

const STATUS: Record<
  MyApplication['status'],
  { label: string; tone: 'neutral' | 'ember' | 'success' | 'danger' }
> = {
  pending: { label: 'Awaiting host', tone: 'neutral' },
  accepted: { label: 'Accepted, pay to enter', tone: 'ember' },
  joined: { label: 'You are in', tone: 'success' },
  rejected: { label: 'Not this time', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  expired: { label: 'Payment window ended', tone: 'danger' },
};

const HOST_STATUS: typeof STATUS = {
  pending: { label: 'To review', tone: 'ember' },
  accepted: { label: 'Awaiting payment', tone: 'neutral' },
  joined: { label: 'Joined', tone: 'success' },
  rejected: { label: 'Declined', tone: 'neutral' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  expired: { label: 'Payment window ended', tone: 'danger' },
};

export const ApplicationBadge = ({
  status,
  viewer = 'member',
}: {
  status: MyApplication['status'];
  viewer?: 'member' | 'host';
}) => {
  const { label, tone } = (viewer === 'host' ? HOST_STATUS : STATUS)[status];
  return <Badge tone={tone}>{label}</Badge>;
};
