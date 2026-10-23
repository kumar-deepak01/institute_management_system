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
  const { serviceUnavailableMessage, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  if (requestOptions.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${apiBaseUrl}${path}`, { ...requestOptions, headers, credentials: 'include', body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body) });
  let parseFailed = false;
  let result: unknown;
  try { result = await response.json(); } catch { parseFailed = true; result = {}; }
  if (serviceUnavailableMessage && (response.status === 404 || parseFailed || !response.headers.get('content-type')?.toLowerCase().includes('json'))) {
    throw new ApiRequestError(serviceUnavailableMessage, response.status);
  }
  if (!response.ok) {
    if (response.status === 401) clearCurrentAccountCache();
    const message = typeof result === 'object' && result !== null && 'error' in result ? (result as ApiError).error : `Request failed (${response.status})`;
    throw new ApiRequestError(message, response.status);
  }
  return result as T;
}
