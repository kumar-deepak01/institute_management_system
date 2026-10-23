import { apiRequest } from './api';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export type TeacherContext = { batches: Array<{ id: string; name: string; courseId: string }>; subjects: Array<{ id: string; name: string; courseId: string; batchId: string }>; profile: any; today: string };
async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export const getTeacherContext = () => apiRequest<TeacherContext>('/api/teacher/context');
export const getTeacherPage = <T,>(page: string, query = '') => apiRequest<T>(`/api/teacher/${page}${query}`);
export const saveTeacherPage = async <T,>(page: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown) => apiRequest<T>(`/api/teacher/${page}`, { method, headers: await csrfHeaders(), body });
export const deleteTeacherPage = async (page: string) => apiRequest(`/api/teacher/${page}`, { method: 'DELETE', headers: await csrfHeaders() });
export async function uploadTeacherFile(file: File, fields: Record<string, string>) {
  const data = new FormData();
  data.set('file', file);
  Object.entries(fields).forEach(([key, value]) => data.set(key, value));
  const headers = await csrfHeaders();
  const response = await fetch(`${apiBaseUrl}/api/teacher/shared-files`, { method: 'POST', credentials: 'include', headers, body: data });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Request failed (${response.status})`);
  return result;
}
export async function fetchTeacherPayslip(id: string) {
  const response = await fetch(`${apiBaseUrl}/api/teacher/payslips/${encodeURIComponent(id)}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Payslip could not be downloaded.');
  return response.blob();
}
