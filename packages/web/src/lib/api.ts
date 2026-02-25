import { clearAuthStorage, getAccessToken } from '../auth/storage';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const token = getAccessToken();
  const hasBody = options.body !== undefined;

  const headers = new Headers(options.headers ?? {});
  headers.set('Accept', 'application/json');

  if (hasBody) {
    headers.set('Content-Type', 'application/json');
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? ((await response.json()) as unknown) : undefined;

  if (!response.ok) {
    if (response.status === 401) {
      clearAuthStorage();
    }

    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? String((payload as { message?: string }).message)
        : 'Request failed.';

    throw new ApiError(message, response.status);
  }

  return payload as T;
}
