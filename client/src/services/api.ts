import type { ApiError, ApiOptions } from '../types/api';
import { clearCurrentAccountCache } from './authCache';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBaseUrl}${path}`, { ...options, headers, credentials: 'include', body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const result: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearCurrentAccountCache();
    const message = typeof result === 'object' && result !== null && 'error' in result ? (result as ApiError).error : `Request failed (${response.status})`;
    throw new ApiRequestError(message, response.status);
  }
  return result as T;
}
