import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import { formatPaise } from '@agnipath/shared';
import type { AdminPlan, AdminRoom, Paginated } from '@agnipath/shared';
import {
  Button,
  Cell,
  ConfirmButton,
  Field,
  Modal,
  PageHeader,
  Pager,
  Panel,
  Pill,
  SearchBox,
  Select,
  Table,
  TableState,
  Toolbar,
} from '../ui';
import { api } from '../../lib/client';
import { date } from '../format';

const PAGE_SIZE = 25;

const roomPill = (room: AdminRoom) => {
  if (room.live) return <Pill tone="good">live</Pill>;
  if (room.status === 'pending_payment') return <Pill tone="warn">awaiting payment</Pill>;
  return <Pill>{room.status === 'open' ? 'ended' : 'closed'}</Pill>;
};

export const RoomsPage = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState<AdminRoom | null>(null);
  const q = useDeferredValue(search.trim());

  const rooms = useQuery({
    queryKey: ['admin-rooms', { q, status, page }],
    queryFn: () =>
      api.get<Paginated<AdminRoom>>('/v1/admin/rooms', { q, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Rooms" />
      <Panel>
        <Toolbar>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search room or host"
          />
          <Select
            aria-label="Status"
            className="w-auto!"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any status</option>
            <option value="open">Open</option>
            <option value="pending_payment">Awaiting payment</option>
            <option value="closed">Closed</option>
          </Select>
        </Toolbar>

        <TableState
          isPending={rooms.isPending}
          error={rooms.error}
          isEmpty={rooms.data?.items.length === 0}
          emptyLabel="No rooms match these filters."
        />
        {rooms.data && rooms.data.items.length > 0 && (
          <>
            <Table head={['Room', 'Host', 'Status', 'Plan', 'Seats', 'Ticket', 'Ends', '']}>
              {rooms.data.items.map((room) => (
                <tr key={room.id}>
                  <Cell>
                    <p className="max-w-64 truncate font-medium">{room.title}</p>
                    <p className="text-muted">{room.pendingApplications} to review</p>
                  </Cell>
                  <Cell>
                    <p>{room.hostDisplayName}</p>
                    <p className="text-muted">{room.hostEmail}</p>
                  </Cell>
                  <Cell>{roomPill(room)}</Cell>
                  <Cell>{room.planName}</Cell>
                  <Cell className="tabular-nums">
                    {room.seatsTaken}/{room.capacity}
                  </Cell>
                  <Cell className="tabular-nums">{formatPaise(room.ticketPricePaise)}</Cell>
                  <Cell className="whitespace-nowrap">{date(room.endsAt)}</Cell>
                  <Cell className="text-right">
                    <Button onClick={() => setManaging(room)}>Manage</Button>
                  </Cell>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={rooms.data.total} onChange={setPage} />
          </>
        )}
      </Panel>
      {managing && <ManageRoom room={managing} onClose={() => setManaging(null)} />}
    </>
  );
};

const ManageRoom = ({ room, onClose }: { room: AdminRoom; onClose: () => void }) => {
  const [planId, setPlanId] = useState(room.planId);
  const queryClient = useQueryClient();

  const plans = useQuery({
    queryKey: ['admin-plans'],
    queryFn: () => api.get<AdminPlan[]>('/v1/admin/plans'),
  });

  const update = useMutation({
    mutationFn: (body: { planId?: string; status?: 'open' | 'closed' }) =>
      api.patch(`/v1/admin/rooms/${room.id}`, body),
    onSuccess: async () => {
      toast.success('Room updated');
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const target = plans.data?.find((plan) => plan.id === planId);
  const paid = Boolean(room.startsAt);

  return (
    <Modal title={room.title} onClose={onClose}>
      <section>
        <h3 className="font-medium">Plan</h3>
        {paid ? (
          <>
            <p className="mb-3 text-muted">
              Moving a room applies the new capacity, length and features straight away. Nothing is
              charged or refunded automatically.
            </p>
            <Field label="Plan">
              <Select value={planId} onChange={(event) => setPlanId(event.target.value)}>
                {plans.data?.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name} ({plan.capacity} people, {plan.durationDays} days)
                  </option>
                ))}
              </Select>
            </Field>
            {target && target.id !== room.planId && (
              <p className="mt-2 text-muted">
                Capacity {room.capacity} to {target.capacity}, length {room.durationDays} to{' '}
                {target.durationDays} days, commission to {target.platformFeeBps / 100}%.
              </p>
            )}
            <Button
              variant="primary"
              className="mt-3"
              disabled={planId === room.planId}
              loading={update.isPending}
              onClick={() => update.mutate({ planId })}
            >
              Change plan
            </Button>
          </>
        ) : (
          <p className="text-muted">The host has not paid for this room yet.</p>
        )}
      </section>

      <section className="mt-5 border-t border-line pt-4">
        <h3 className="font-medium">Availability</h3>
        <p className="mb-3 text-muted">
          Closing removes the room from Explore. Ticket payments that arrive afterwards are flagged
          for refund.
        </p>
        {room.status === 'closed' ? (
          <Button disabled={!paid} onClick={() => update.mutate({ status: 'open' })}>
            Reopen room
          </Button>
        ) : (
          <ConfirmButton
            variant="danger"
            confirmLabel="Confirm close"
            onConfirm={() => update.mutate({ status: 'closed' })}
          >
            Close room
          </ConfirmButton>
        )}
      </section>
    </Modal>
  );
};
