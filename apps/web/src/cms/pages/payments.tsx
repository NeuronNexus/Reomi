import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { formatPaise } from '@reomi/shared';
import type { AdminPayment, Paginated } from '@reomi/shared';
import {
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

const TONE: Record<AdminPayment['status'], Tone> = {
  created: 'neutral',
  paid: 'good',
  refund_required: 'bad',
  refunded: 'warn',
};

const LABEL: Record<AdminPayment['status'], string> = {
  created: 'unpaid',
  paid: 'paid',
  refund_required: 'refund due',
  refunded: 'refunded',
};

export const PaymentsPage = () => {
  const [status, setStatus] = useState('');
  const [purpose, setPurpose] = useState('');
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();

  const payments = useQuery({
    queryKey: ['payments', { status, purpose, page }],
    queryFn: () =>
      api.get<Paginated<AdminPayment>>('/v1/admin/payments', {
        status,
        purpose,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const markRefunded = useMutation({
    mutationFn: (id: string) => api.post(`/v1/admin/payments/${id}/mark-refunded`),
    onSuccess: () => {
      toast.success('Marked as refunded');
      return queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Issue refunds in the Razorpay dashboard first, then record them here."
      />
      <Panel>
        <Toolbar>
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
            <option value="paid">Paid</option>
            <option value="refund_required">Refund due</option>
            <option value="refunded">Refunded</option>
            <option value="created">Unpaid</option>
          </Select>
          <Select
            aria-label="Type"
            className="w-auto!"
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Any type</option>
            <option value="host_plan">Host plans</option>
            <option value="room_ticket">Tickets</option>
          </Select>
        </Toolbar>

        <TableState
          isPending={payments.isPending}
          error={payments.error}
          isEmpty={payments.data?.items.length === 0}
          emptyLabel="No payments match these filters."
        />
        {payments.data && payments.data.items.length > 0 && (
          <>
            <Table head={['Payer', 'For', 'Status', 'Amount', 'Platform', 'Host', 'Date', '']}>
              {payments.data.items.map((payment) => (
                <tr key={payment.id}>
                  <Cell>{payment.userEmail}</Cell>
                  <Cell>
                    <p className="max-w-56 truncate">{payment.roomTitle}</p>
                    <p className="text-muted">
                      {payment.purpose === 'host_plan' ? 'Host plan' : 'Ticket'}
                    </p>
                  </Cell>
                  <Cell>
                    <Pill tone={TONE[payment.status]}>{LABEL[payment.status]}</Pill>
                  </Cell>
                  <Cell className="tabular-nums">{formatPaise(payment.amountPaise)}</Cell>
                  <Cell className="tabular-nums">{formatPaise(payment.platformFeePaise)}</Cell>
                  <Cell className="tabular-nums">{formatPaise(payment.hostEarningPaise)}</Cell>
                  <Cell className="whitespace-nowrap">
                    {dateTime(payment.paidAt ?? payment.createdAt)}
                  </Cell>
                  <Cell className="text-right">
                    {payment.status === 'refund_required' && (
                      <ConfirmButton
                        confirmLabel="Confirm refunded"
                        onConfirm={() => markRefunded.mutate(payment.id)}
                      >
                        Mark refunded
                      </ConfirmButton>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
            <Pager
              page={page}
              pageSize={PAGE_SIZE}
              total={payments.data.total}
              onChange={setPage}
            />
          </>
        )}
      </Panel>
    </>
  );
};
