import { createContext, use, useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { APP_NAME, formatPaise } from '@reomi/shared';
import type { Checkout, PaymentResult } from '@reomi/shared';
import { Button } from '../components/ui';
import { useAuth } from './auth';
import { api } from './client';

interface ProviderReceipt {
  providerPaymentId: string;
  signature: string;
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill?: { email?: string };
  theme?: { color: string };
  handler: (response: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

export class CheckoutCancelled extends Error {}

let razorpayScript: Promise<void> | null = null;

const loadRazorpay = (): Promise<void> => {
  razorpayScript ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => {
      razorpayScript = null;
      reject(new Error('Could not load the payment window. Check your connection.'));
    };
    document.body.append(script);
  });
  return razorpayScript;
};

type Pay = (checkout: Checkout) => Promise<PaymentResult>;

const CheckoutContext = createContext<Pay | null>(null);

export const CheckoutProvider = ({ children }: { children: ReactNode }) => {
  const { me } = useAuth();
  const [mockOrder, setMockOrder] = useState<Checkout | null>(null);
  const mockDecision = useRef<{
    resolve: (receipt: ProviderReceipt) => void;
    reject: (reason: Error) => void;
  } | null>(null);

  const collectPayment = useCallback(
    async (checkout: Checkout): Promise<ProviderReceipt> => {
      if (checkout.provider === 'mock') {
        return new Promise((resolve, reject) => {
          mockDecision.current = { resolve, reject };
          setMockOrder(checkout);
        });
      }

      await loadRazorpay();
      return new Promise((resolve, reject) => {
        const Razorpay = window.Razorpay;
        if (!Razorpay) {
          reject(new Error('The payment window is unavailable.'));
          return;
        }
        new Razorpay({
          key: checkout.publicKey,
          order_id: checkout.orderId,
          amount: checkout.amountPaise,
          currency: checkout.currency,
          name: APP_NAME,
          description: checkout.description,
          prefill: { email: me?.email },
          theme: { color: '#ff6a33' },
          handler: (response) =>
            resolve({
              providerPaymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature,
            }),
          modal: { ondismiss: () => reject(new CheckoutCancelled()) },
        }).open();
      });
    },
    [me?.email],
  );

  const pay = useCallback<Pay>(
    async (checkout) => {
      const receipt = await collectPayment(checkout);
      return api.post<PaymentResult>(`/v1/payments/${checkout.paymentId}/confirm`, receipt);
    },
    [collectPayment],
  );

  const closeMock = (paid: boolean) => {
    const order = mockOrder;
    setMockOrder(null);
    if (paid && order) {
      mockDecision.current?.resolve({
        providerPaymentId: `mock_pay_${order.orderId}`,
        signature: 'mock_signature',
      });
    } else {
      mockDecision.current?.reject(new CheckoutCancelled());
    }
  };

  const value = useMemo(() => pay, [pay]);

  return (
    <CheckoutContext value={value}>
      {children}
      {mockOrder && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Demo payment"
            className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6"
          >
            <p className="text-xs font-semibold tracking-widest text-amber uppercase">
              Demo payment
            </p>
            <h2 className="mt-2 font-display text-3xl">{formatPaise(mockOrder.amountPaise)}</h2>
            <p className="mt-1 text-sm text-muted">{mockOrder.description}</p>
            <p className="mt-4 rounded-lg bg-raised p-3 text-sm text-muted">
              Reomi is in demo mode. No money moves and no card is needed. Real checkout uses Razorpay.
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => closeMock(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={() => closeMock(true)}>
                Pay now
              </Button>
            </div>
          </div>
        </div>
      )}
    </CheckoutContext>
  );
};

export const useCheckout = (): Pay => {
  const context = use(CheckoutContext);
  if (!context) throw new Error('useCheckout must be used inside CheckoutProvider');
  return context;
};
