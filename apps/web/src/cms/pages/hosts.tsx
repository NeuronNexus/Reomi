import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import type { AdminHost, Paginated } from '@agnipath/shared';
import {
  Button,
  Cell,
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
  Textarea,
  Toolbar,
} from '../ui';
import type { Tone } from '../ui';
import { api } from '../../lib/client';
import { date } from '../format';

const PAGE_SIZE = 25;

const TONE: Record<AdminHost['status'], Tone> = {
  pending: 'warn',
  verified: 'good',
  rejected: 'neutral',
  revoked: 'bad',
};

type Decision = 'verified' | 'rejected' | 'revoked';

const DECISION_LABEL: Record<Decision, string> = {
  verified: 'Approve',
  rejected: 'Reject',
  revoked: 'Revoke',
};

export const HostsPage = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [reviewing, setReviewing] = useState<AdminHost | null>(null);
  const q = useDeferredValue(search.trim());

  const hosts = useQuery({
    queryKey: ['hosts', { q, status, page }],
    queryFn: () =>
      api.get<Paginated<AdminHost>>('/v1/admin/hosts', { q, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Hosts" subtitle="Only verified hosts can create rooms." />
      <Panel>
        <Toolbar>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search host name or email"
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
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="rejected">Rejected</option>
            <option value="revoked">Revoked</option>
          </Select>
        </Toolbar>

        <TableState
          isPending={hosts.isPending}
          error={hosts.error}
          isEmpty={hosts.data?.items.length === 0}
          emptyLabel="No hosts match these filters."
        />
        {hosts.data && hosts.data.items.length > 0 && (
          <>
            <Table head={['Host', 'Person', 'Status', 'Rooms', 'Applied', '']}>
              {hosts.data.items.map((host) => (
                <tr key={host.userId}>
                  <Cell className="font-medium">{host.displayName}</Cell>
                  <Cell>
                    <p>{host.fullName}</p>
                    <p className="text-muted">{host.email}</p>
                  </Cell>
                  <Cell>
                    <Pill tone={TONE[host.status]}>{host.status}</Pill>
                  </Cell>
                  <Cell className="whitespace-nowrap">
                    {host.liveRooms} live, {host.roomsHosted} total
                  </Cell>
                  <Cell className="whitespace-nowrap">{date(host.createdAt)}</Cell>
                  <Cell className="text-right">
                    <Button
                      variant={host.status === 'pending' ? 'primary' : 'default'}
                      onClick={() => setReviewing(host)}
                    >
                      {host.status === 'pending' ? 'Review' : 'Manage'}
                    </Button>
                  </Cell>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={hosts.data.total} onChange={setPage} />
          </>
        )}
      </Panel>
      {reviewing && <ReviewModal host={reviewing} onClose={() => setReviewing(null)} />}
    </>
  );
};

const ReviewModal = ({ host, onClose }: { host: AdminHost; onClose: () => void }) => {
  const [note, setNote] = useState(host.reviewNote ?? '');
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (status: Decision) =>
      api.patch(`/v1/admin/hosts/${host.userId}`, {
        status,
        ...(note.trim() ? { reviewNote: note.trim() } : {}),
      }),
    onSuccess: async () => {
      toast.success('Host updated');
      await queryClient.invalidateQueries();
      onClose();
    },
    onError: (error) => toast.error(error.message),
  });

  const options: Decision[] =
    host.status === 'verified'
      ? ['revoked']
      : host.status === 'pending'
        ? ['verified', 'rejected']
        : ['verified'];

  return (
    <Modal title={host.displayName} onClose={onClose}>
      <dl className="space-y-3">
        <div>
          <dt className="text-muted">Person</dt>
          <dd>
            {host.fullName} ({host.email})
          </dd>
        </div>
        <div>
          <dt className="text-muted">Why they want to host</dt>
          <dd className="whitespace-pre-line">{host.about}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Field label="Note to the applicant" hint="They see this on their Hosting page.">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {options.map((option) => (
          <Button
            key={option}
            variant={option === 'verified' ? 'primary' : 'danger'}
            loading={decide.isPending && decide.variables === option}
            disabled={decide.isPending}
            onClick={() => decide.mutate(option)}
          >
            {DECISION_LABEL[option]}
          </Button>
        ))}
      </div>
    </Modal>
  );
};
