import { apiRequest } from './api';
import type { RecordResponse } from '../types/api';

export async function listRecords<T>(collection: string, token?: string): Promise<T[]> {
  const headers = token ? { 'X-Admission-Admin-Token': token } : undefined;
  return (await apiRequest<RecordResponse<T>>(`/api/${collection}`, { headers })).records;
}
export async function createRecord<T>(collection: string, record: T, token?: string): Promise<T> {
  const headers = token ? { 'X-Admission-Admin-Token': token } : undefined;
  return (await apiRequest<RecordResponse<T>>(`/api/${collection}`, { method: 'POST', headers, body: { record } })).records[0];
}

export async function deleteRecord(collection: string, id: string, token?: string): Promise<void> {
  const headers = token ? { 'X-Admission-Admin-Token': token } : undefined;
  await apiRequest<{ ok: boolean }>(`/api/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE', headers });
}
