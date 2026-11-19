import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { toast } from 'sonner';
import type { AdminUser, Me, Paginated } from '@agnipath/shared';
import {
  Button,
  Cell,
  ConfirmButton,
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
import type { Tone } from '../ui';
import { api } from '../../lib/client';
import { date, relative } from '../format';

const PAGE_SIZE = 25;

const HOST_TONE: Record<string, Tone> = {
  verified: 'good',
  pending: 'warn',
  rejected: 'neutral',
  revoked: 'bad',
};

export const UsersPage = ({ me }: { me: Me }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [activeWithinDays, setActiveWithinDays] = useState('30');
  const [page, setPage] = useState(1);
  const q = useDeferredValue(search.trim());
  const queryClient = useQueryClient();

  const users = useQuery({
    queryKey: ['users', { q, status, activeWithinDays, page }],
    queryFn: () =>
      api.get<Paginated<AdminUser>>('/v1/admin/users', {
        q,
        status,
        activeWithinDays,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const setUserStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'active' | 'suspended' }) =>
      api.patch(`/v1/admin/users/${id}`, { status: next }),
    onSuccess: () => {
      toast.success('User updated');
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Real identities. Never share these outside this portal."
      />
      <Panel>
        <Toolbar>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search name or email"
          />
          <Select
            aria-label="Activity"
            className="w-auto!"
            value={activeWithinDays}
            onChange={(event) => {
              setActiveWithinDays(event.target.value);
              setPage(1);
            }}
          >
            <option value="1">Active in 24 hours</option>
            <option value="7">Active in 7 days</option>
            <option value="30">Active in 30 days</option>
            <option value="">All users</option>
          </Select>
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
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
        </Toolbar>

        <TableState
          isPending={users.isPending}
          error={users.error}
          isEmpty={users.data?.items.length === 0}
          emptyLabel="No users match these filters."
        />
        {users.data && users.data.items.length > 0 && (
          <>
            <Table head={['User', 'Status', 'Host', 'Last seen', 'Joined', '']}>
              {users.data.items.map((user) => (
                <tr key={user.id}>
                  <Cell>
                    <p className="font-medium">{user.fullName ?? 'Not onboarded'}</p>
                    <p className="text-muted">{user.email}</p>
                  </Cell>
                  <Cell>
                    <Pill tone={user.status === 'active' ? 'good' : 'bad'}>{user.status}</Pill>
                    {user.role === 'admin' && (
                      <span className="ml-1">
                        <Pill tone="accent">admin</Pill>
                      </span>
                    )}
                  </Cell>
                  <Cell>
                    {user.hostStatus ? (
                      <Pill tone={HOST_TONE[user.hostStatus]}>{user.hostStatus}</Pill>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </Cell>
                  <Cell className="whitespace-nowrap">{relative(user.lastSeenAt)}</Cell>
                  <Cell className="whitespace-nowrap">{date(user.createdAt)}</Cell>
                  <Cell className="text-right">
                    {user.role !== 'admin' &&
                      user.id !== me.id &&
                      (user.status === 'active' ? (
                        <ConfirmButton
                          variant="danger"
                          confirmLabel="Confirm suspend"
                          onConfirm={() => setUserStatus.mutate({ id: user.id, next: 'suspended' })}
                        >
                          Suspend
                        </ConfirmButton>
                      ) : (
                        <Button
                          onClick={() => setUserStatus.mutate({ id: user.id, next: 'active' })}
                        >
                          Restore
                        </Button>
                      ))}
                  </Cell>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={users.data.total} onChange={setPage} />
          </>
        )}
      </Panel>
    </>
  );
};
