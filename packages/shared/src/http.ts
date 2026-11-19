import type { ApiError } from './schemas';

type ErrorCode = ApiError['error']['code'];

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network_error',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ApiClient {
  get<T>(path: string, query?: Record<string, unknown>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

const toQueryString = (query: Record<string, unknown> = {}): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
};

export interface ApiClientHooks {
  /** Called around every request, for example to notice a sleeping server. */
  onStart?: () => void;
  onEnd?: () => void;
}

/** Browser client for the API. `getToken` is called per request so refreshed tokens are used. */
export const createApiClient = (
  baseUrl: string,
  getToken: () => Promise<string | null>,
  hooks: ApiClientHooks = {},
): ApiClient => {
  const request = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    hooks.onStart?.();
    try {
      return await send<T>(method, path, body);
    } finally {
      hooks.onEnd?.();
    }
  };

  const send = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const token = await getToken();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiRequestError(0, 'network_error', 'Could not reach the server. Try again.');
    }

    if (response.status === 204) return undefined as T;
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = (payload as ApiError | null)?.error;
      throw new ApiRequestError(
        response.status,
        error?.code ?? 'internal_error',
        error?.message ?? 'Something went wrong',
        error?.details,
      );
    }
    return payload as T;
  };

  return {
    get: (path, query) => request('GET', `${path}${toQueryString(query)}`),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
};
