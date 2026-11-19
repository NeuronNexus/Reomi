import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Config } from '../config';
import { AppError } from './errors';

export interface ProviderPayment {
  status: 'captured' | 'authorized' | 'other';
  orderId: string;
  amountPaise: number;
}

export interface PaymentProvider {
  readonly name: 'razorpay' | 'mock';
  readonly publicKey: string;
  createOrder(input: {
    amountPaise: number;
    currency: string;
    receipt: string;
  }): Promise<{ orderId: string }>;
  verifyCheckoutSignature(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }): boolean;
  fetchPayment(paymentId: string): Promise<ProviderPayment>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
}

const hmacMatches = (secret: string, payload: string | Buffer, signature: string): boolean => {
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export class RazorpayProvider implements PaymentProvider {
  readonly name = 'razorpay';
  readonly publicKey: string;
  private readonly authorization: string;

  constructor(
    keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
    private readonly baseUrl = 'https://api.razorpay.com/v1',
  ) {
    this.publicKey = keyId;
    this.authorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: this.authorization, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      throw new AppError(502, 'payment_provider_error', 'Payment provider is unreachable', {
        cause: String(cause),
      });
    }
    if (!response.ok) {
      throw new AppError(502, 'payment_provider_error', 'Payment provider rejected the request', {
        status: response.status,
      });
    }
    return (await response.json()) as T;
  }

  async createOrder(input: { amountPaise: number; currency: string; receipt: string }) {
    const order = await this.request<{ id: string }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: input.currency,
        receipt: input.receipt,
      }),
    });
    return { orderId: order.id };
  }

  verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }) {
    return hmacMatches(this.keySecret, `${input.orderId}|${input.paymentId}`, input.signature);
  }

  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const payment = await this.request<{ status: string; order_id: string; amount: number }>(
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return {
      status:
        payment.status === 'captured' || payment.status === 'authorized' ? payment.status : 'other',
      orderId: payment.order_id,
      amountPaise: payment.amount,
    };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string) {
    return hmacMatches(this.webhookSecret, rawBody, signature);
  }
}

/** Local development only. Config validation refuses this provider in production. */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly publicKey = 'mock';

  /** The amount travels in the id, so open orders survive a dev server restart. */
  async createOrder(input: { amountPaise: number }) {
    return { orderId: `mock_order_${input.amountPaise}_${randomUUID()}` };
  }

  verifyCheckoutSignature(input: { signature: string }) {
    return input.signature === 'mock_signature';
  }

  /** A mock payment id is `mock_pay_<order id>`. */
  async fetchPayment(paymentId: string): Promise<ProviderPayment> {
    const orderId = paymentId.replace(/^mock_pay_/, '');
    return { status: 'captured', orderId, amountPaise: Number(orderId.split('_')[2]) };
  }

  verifyWebhookSignature() {
    return false;
  }
}

export const createPaymentProvider = (config: Config): PaymentProvider =>
  config.PAYMENT_PROVIDER === 'mock'
    ? new MockProvider()
    : new RazorpayProvider(
        config.RAZORPAY_KEY_ID!,
        config.RAZORPAY_KEY_SECRET!,
        config.RAZORPAY_WEBHOOK_SECRET!,
      );
