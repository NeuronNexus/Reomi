import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Checkout } from '@agnipath/shared';
import { CheckoutCancelled, useCheckout } from './checkout';
import { api } from './client';

/** Runs the ticket purchase, including the rare case where the seat is gone by the time it lands. */
export const usePayTicket = () => {
  const pay = useCheckout();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (applicationId: string) =>
      pay(await api.post<Checkout>(`/v1/applications/${applicationId}/checkout`)),
    onSuccess: (result) => {
      if (result.processing) {
        toast.info('Payment received. We are confirming it with the bank.');
      } else if (result.status === 'paid') {
        toast.success('You are in. Welcome to the room.');
      } else {
        toast.error('That seat is no longer available. Your payment will be refunded.');
      }
    },
    onError: (error) => {
      if (!(error instanceof CheckoutCancelled)) toast.error(error.message);
    },
    onSettled: () => queryClient.invalidateQueries(),
  });
};
