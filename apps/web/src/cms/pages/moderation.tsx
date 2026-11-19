import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AdminCommunity, AdminFlag, Paginated } from '@reomi/shared';
import {
  Button,
  Cell,
  ConfirmButton,
  PageHeader,
  Pager,
  Panel,
  Pill,
  Select,
  Table,
  TableState,
  Toolbar,
} from '../ui';
import type { Tone } from '../ui';
import { api } from '../../lib/client';
import { dateTime } from '../format';

const PAGE_SIZE = 25;

const REASON: Record<AdminFlag['reason'], string> = {
  identity_other: 'Exposed someone',
  identity_self: 'Self-disclosure',
  contact_info: 'Contact details',
  harassment: 'Harassment',
  user_report: 'User report',
};

const SEVERITY: Record<AdminFlag['severity'], Tone> = {
  strong: 'bad',
  soft: 'neutral',
  report: 'warn',
};

export const ModerationPage = () => {
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const flags = useQuery({
    queryKey: ['flags', { status, severity, page }],
    queryFn: () =>
      api.get<Paginated<AdminFlag>>('/v1/admin/flags', {
        status,
        severity,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const review = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      status: 'dismissed' | 'actioned';
      suspendUser: boolean;
    }) => api.patch(`/v1/admin/flags/${id}`, body),
    onSuccess: () => {
      toast.success('Flag updated');
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Moderation"
        subtitle="Messages and posts the system blocked before delivery, plus reports from members. Strong flags count as strikes; dismissing one removes the strike."
      />
      <Panel>
        <Toolbar>
          <Select
            aria-label="Status"
            className="w-auto!"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="open">Open</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All</option>
          </Select>
          <Select
            aria-label="Severity"
            className="w-auto!"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Any severity</option>
            <option value="strong">Strikes</option>
            <option value="report">Reports</option>
            <option value="soft">Held back only</option>
          </Select>
        </Toolbar>
        <TableState
          isPending={flags.isPending}
          error={flags.error}
          isEmpty={flags.data?.items.length === 0}
          emptyLabel="Nothing to review."
        />
        {flags.data && flags.data.items.length > 0 && (
          <>
            <Table head={['Person', 'What happened', 'Content', 'Where', 'When', '']}>
              {flags.data.items.map((flag) => (
                <tr key={flag.id} className="align-top">
                  <Cell>
                    <p className="max-w-48 truncate">{flag.userName ?? flag.userEmail}</p>
                    <p className="max-w-48 truncate text-muted">{flag.userEmail}</p>
                    <p className="mt-1 text-muted">
                      {flag.strikes} strike{flag.strikes === 1 ? '' : 's'} / 30 days
                      {flag.userStatus === 'suspended' && (
                        <span className="ml-1 text-bad">· suspended</span>
                      )}
                    </p>
                  </Cell>
                  <Cell>
                    <Pill tone={SEVERITY[flag.severity]}>{REASON[flag.reason]}</Pill>
                    <p className="mt-1 text-muted">{flag.context}</p>
                    {flag.reporterEmail && <p className="text-muted">by {flag.reporterEmail}</p>}
                  </Cell>
                  <Cell>
                    <p className="max-w-80 whitespace-pre-wrap">{flag.excerpt}</p>
                  </Cell>
                  <Cell className="text-muted">{flag.where ?? '—'}</Cell>
                  <Cell className="whitespace-nowrap">{dateTime(flag.createdAt)}</Cell>
                  <Cell className="text-right">
                    {flag.status === 'open' ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <Button
                          onClick={() =>
                            review.mutate({ id: flag.id, status: 'dismissed', suspendUser: false })
                          }
                        >
                          Dismiss
                        </Button>
                        <Button
                          onClick={() =>
                            review.mutate({ id: flag.id, status: 'actioned', suspendUser: false })
                          }
                        >
                          Keep
                        </Button>
                        {flag.userStatus === 'active' && (
                          <ConfirmButton
                            confirmLabel="Confirm suspend"
                            onConfirm={() =>
                              review.mutate({ id: flag.id, status: 'actioned', suspendUser: true })
                            }
                          >
                            Suspend user
                          </ConfirmButton>
                        )}
                      </div>
                    ) : (
                      <Pill tone={flag.status === 'actioned' ? 'warn' : 'neutral'}>
                        {flag.status}
                      </Pill>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={flags.data.total} onChange={setPage} />
          </>
        )}
      </Panel>
    </>
  );
};

export const CommunitiesAdminPage = () => {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin-communities', page],
    queryFn: () =>
      api.get<Paginated<AdminCommunity>>('/v1/admin/communities', { page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader
        title="Communities"
        subtitle="Private interest communities. Their owners and moderators run them day to day."
      />
      <Panel>
        <TableState
          isPending={list.isPending}
          error={list.error}
          isEmpty={list.data?.items.length === 0}
          emptyLabel="No communities yet."
        />
        {list.data && list.data.items.length > 0 && (
          <>
            <Table head={['Community', 'Topic', 'Access', 'Members', 'Posts', 'Owner', 'Created']}>
              {list.data.items.map((community) => (
                <tr key={community.id}>
                  <Cell>
                    <a
                      href={`/c/${community.slug}`}
                      className="font-medium hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {community.name}
                    </a>
                  </Cell>
                  <Cell className="text-muted">{community.topic}</Cell>
                  <Cell>
                    <Pill tone={community.visibility === 'private' ? 'accent' : 'neutral'}>
                      {community.visibility}
                    </Pill>
                  </Cell>
                  <Cell className="tabular-nums">{community.memberCount}</Cell>
                  <Cell className="tabular-nums">{community.postCount}</Cell>
                  <Cell className="text-muted">{community.ownerEmail}</Cell>
                  <Cell className="whitespace-nowrap">{dateTime(community.createdAt)}</Cell>
                </tr>
              ))}
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onChange={setPage} />
          </>
        )}
      </Panel>
    </>
  );
};
