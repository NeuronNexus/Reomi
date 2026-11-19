import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatPaise } from '@agnipath/shared';
import type { MyApplication } from '@agnipath/shared';
import { AuraAvatar } from '../components/aura';
import { ApplicationBadge } from '../components/status';
import { Button, EmptyState, ErrorNotice, LinkButton, PageTitle, Spinner } from '../components/ui';
import { api } from '../lib/client';
import { shortDate } from '../lib/format';
import { usePayTicket } from '../lib/use-pay-ticket';

export const MyRoomsPage = () => {
  const applications = useQuery({
    queryKey: ['my-applications'],
    queryFn: () => api.get<MyApplication[]>('/v1/me/applications'),
  });
  const payTicket = usePayTicket();

  return (
    <>
      <PageTitle title="My rooms" subtitle="Every room you have applied to, and where it stands." />
      {applications.isPending && <Spinner />}
      {applications.isError && <ErrorNotice error={applications.error} />}
      {applications.data?.length === 0 && (
        <EmptyState
          title="No applications yet"
          body="Find a room that sounds like you and tell the host why."
          action={<LinkButton to="/">Explore rooms</LinkButton>}
        />
      )}
      <ul className="space-y-3">
        {applications.data?.map((application) => (
          <li
            key={application.id}
            className="flex flex-wrap items-center gap-4 rounded-2xl border border-line bg-surface p-4"
          >
            <AuraAvatar seed={application.alias} />
            <div className="min-w-48 flex-1">
              <Link
                to={`/rooms/${application.roomId}`}
                className="font-display text-xl hover:text-amber"
              >
                {application.roomTitle}
              </Link>
              <p className="text-sm text-muted">as {application.alias}</p>
              {application.status === 'accepted' && application.paymentDueAt && (
                <p className="text-sm text-amber">
                  Seat held until {shortDate(application.paymentDueAt)}
                </p>
              )}
            </div>
            <ApplicationBadge status={application.status} />
            {application.status === 'accepted' && (
              <Button
                loading={payTicket.isPending && payTicket.variables === application.id}
                onClick={() => payTicket.mutate(application.id)}
              >
                Pay {formatPaise(application.ticketPricePaise)}
              </Button>
            )}
            {application.status === 'joined' && (
              <LinkButton to={`/rooms/${application.roomId}/lobby`}>Enter room</LinkButton>
            )}
          </li>
        ))}
      </ul>
    </>
  );
};
