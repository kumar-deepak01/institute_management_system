import { apiRequest } from './api';

const apiBaseUrl = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export type ContentRecord = { id: string; title: string; description?: string; status: string; contentType?: string; subjectId?: string; subjectName?: string; accessPermission?: string; externalUrl?: string; attachments?: { id: string; name: string; type: string; size: number }[]; createdAt?: string; batchId?: string; batchName?: string; chapter?: string; topic?: string; views?: number; completion?: number; provider?: string; meetingId?: string | null; hostUrl?: string | null; providerCalendarId?: string | null; teacherKey?: string; teacherName?: string; scheduledAt?: string; durationMinutes?: number; recurringDaily?: boolean; meetingUrl?: string; notes?: string };
export type ContentList = { records: ContentRecord[]; total: number; page: number; limit: number; pages: number; schemaPending?: boolean };
export type ContentLookups = { batches: { id: string; name: string }[]; subjects: { id: string; name: string; courseId?: string }[]; teachers: { id: string; name: string; role?: string }[]; schemaPending?: boolean };

export function getContentList(kind: 'downloads' | 'videos' | 'live-classes', params: Record<string, string | number>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => { if (value !== '') query.set(key, String(value)); });
  return apiRequest<ContentList>(`/api/admin/${kind}?${query.toString()}`);
}
export function getContentStats(kind: 'downloads' | 'videos' | 'live-classes') {
  return apiRequest<Record<string, number | boolean>>(`/api/admin/${kind}/stats`);
}
export function getContentLookups() {
  return apiRequest<ContentLookups>('/api/admin/downloads/lookups');
}
async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export async function uploadContent(kind: 'downloads' | 'videos', data: FormData) {
  const response = await fetch(`${apiBaseUrl}/api/admin/${kind}`, { method: 'POST', credentials: 'include', headers: await csrfHeaders(), body: data });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : `Upload failed (${response.status}).`);
}
export async function mutateContent(path: string, method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', data?: unknown) {
  const headers = await csrfHeaders();
  if (method === 'DELETE') return apiRequest<{ ok: boolean }>(path, { method, headers });
  return apiRequest<{ ok?: boolean; record?: ContentRecord; connected?: boolean; provider?: string }>(path, { method, headers, body: data });
}
export async function getAttachmentUrl(id: string, attachmentId: string) {
  return apiRequest<{ url: string; name: string }>(`/api/admin/downloads/${encodeURIComponent(id)}/attachments?attachmentId=${encodeURIComponent(attachmentId)}`);
}
export async function getVideoUrl(id: string) {
  return apiRequest<{ url: string }>(`/api/admin/videos/${encodeURIComponent(id)}/url`);
}
