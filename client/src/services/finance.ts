import { apiRequest } from './api';

export type FinanceItem = Record<string, unknown> & { id?: string; reversed_at?: string | null };
export type FinanceLookups = {
  students: FinanceItem[];
  batches: FinanceItem[];
  courses: FinanceItem[];
  subjects: FinanceItem[];
  academicYears: FinanceItem[];
  staff: FinanceItem[];
  feeTypes: FinanceItem[];
};
const cache = new Map<string, { expires: number; value: unknown }>();
const CACHE_MS = 12000;
const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function invalidateFinanceCache() { cache.clear(); }
async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export async function financeGet<T>(path: string, fresh = false): Promise<T> {
  const key = path;
  const previous = cache.get(key);
  if (!fresh && previous && previous.expires > Date.now()) return previous.value as T;
  const value = await apiRequest<T>(`/api/admin/finance${path}`);
  cache.set(key, { value, expires: Date.now() + CACHE_MS });
  return value;
}
export async function financePost<T>(path: string, body: unknown): Promise<T> {
  const value = await apiRequest<T>(`/api/admin/finance${path}`, { method: 'POST', headers: await csrfHeaders(), body });
  invalidateFinanceCache();
  return value;
}
export async function financePut<T>(path: string, body: unknown): Promise<T> {
  const value = await apiRequest<T>(`/api/admin/finance${path}`, { method: 'PUT', headers: await csrfHeaders(), body });
  invalidateFinanceCache();
  return value;
}
export async function financeDownload(path: string) {
  const response = await fetch(`${base}/api/admin/finance${path}`, { credentials: 'include' });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => ({}));
    const message = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `Request failed (${response.status})`;
    throw new Error(message);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const name = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'finance-export.csv';
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
