import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatPaise } from '@reomi/shared';
import type { AdminStats } from '@reomi/shared';
import { PageHeader, Panel, TableState } from '../ui';
import { api } from '../../lib/client';

const Tile = ({
  label,
  value,
  note,
  to,
}: {
  label: string;
  value: string | number;
  note?: string;
  to?: string;
}) => {
  const body = (
    <>
      <p className="text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </>
  );
  return (
    <Panel className="p-4">
      {to ? (
        <Link to={to} className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </Panel>
  );
};

export const OverviewPage = () => {
  const stats = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<AdminStats>('/v1/admin/stats'),
  });

  if (!stats.data) {
    return (
      <TableState isPending={stats.isPending} error={stats.error} isEmpty={false} emptyLabel="" />
    );
  }

  const { users, hosts, rooms, revenue } = stats.data;

  return (
    <>
      <PageHeader title="Overview" />

      <h2 className="mb-2 font-medium">People and rooms</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Active users"
          value={users.active30d}
          note={`${users.active24h} in the last 24 hours, ${users.total} registered`}
          to="/admin/users"
        />
        <Tile
          label="Verified hosts"
          value={hosts.verified}
          note={`${hosts.pending} awaiting review`}
          to="/admin/hosts"
        />
        <Tile
          label="Live rooms"
          value={rooms.live}
          note={`${rooms.total} created`}
          to="/admin/rooms"
        />
        <Tile label="Suspended users" value={users.suspended} />
      </div>

      <h2 className="mb-2 font-medium">Money</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Platform revenue"
          value={formatPaise(revenue.platformFeePaise)}
          note="Host plans plus ticket commission"
        />
        <Tile label="Host plan sales" value={formatPaise(revenue.hostPlanPaise)} />
        <Tile
          label="Ticket sales"
          value={formatPaise(revenue.ticketGrossPaise)}
          note={`${formatPaise(revenue.hostLiabilityPaise)} owed to hosts`}
        />
        <Tile
          label="Refunds due"
          value={formatPaise(revenue.refundsDuePaise)}
          note="Paid after a seat or room was gone"
          to="/admin/payments"
        />
      </div>
    </>
  );
};
