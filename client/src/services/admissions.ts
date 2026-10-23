import { apiRequest } from './api';
import type { AdmissionApplication, AdmissionBatch, AdmissionConfig } from '../types/api';

export const getAdmissionConfig = () => apiRequest<AdmissionConfig>('/api/admissions/public/config');
export const getAdmissionBatches = () => apiRequest<AdmissionBatch[]>('/api/admissions/public/batches');
export const submitApplication = (body: Record<string, string | boolean>) => apiRequest<{ ok: true; applicationNo: string; mobile: string; email: string }>('/api/admissions/submit', { method: 'POST', body });

async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'x-csrf-token': csrfToken };
}

export const getApplications = (query: string) => apiRequest<{ applications: AdmissionApplication[]; total: number; page: number; limit: number; pages: number; schemaPending?: boolean }>(`/api/admin/admissions?${query}`);
export const getAdmissionStats = () => apiRequest<{ total: number; pending: number; underReview: number; approved: number; rejected: number; schemaPending?: boolean }>('/api/admin/admissions/stats');
export const getAdminAdmissionLookups = () => apiRequest<{ batches: AdmissionBatch[]; config: AdmissionConfig; schemaPending?: boolean }>('/api/admin/admissions/lookups');
export const updateAdmissionSettings = async (open: boolean) => apiRequest<{ ok: true; config: AdmissionConfig }>('/api/admin/admissions/settings', { method: 'PATCH', headers: await csrfHeaders(), body: { open } });
export const updateApplication = async (applicationNo: string, body: Record<string, unknown>) => apiRequest<{ ok: true; application: AdmissionApplication }>(`/api/admin/admissions/${encodeURIComponent(applicationNo)}`, { method: 'PATCH', headers: await csrfHeaders(), body });
export const approveApplication = async (applicationNo: string, linkExistingStudentId?: string, adminNotes?: string) => apiRequest<{ ok: true; unchanged?: boolean; application: AdmissionApplication; student?: { id: string; name: string } }>(`/api/admin/admissions/${encodeURIComponent(applicationNo)}/approve`, { method: 'POST', headers: await csrfHeaders(), body: { ...(linkExistingStudentId ? { linkExistingStudentId } : {}), ...(adminNotes !== undefined ? { adminNotes } : {}) } });

export async function uploadAdmissionPhoto(applicationNo: string, file: File) {
  const form = new FormData();
  form.append('photo', file, file.name);
  const response = await fetch(`/api/admissions/public/${encodeURIComponent(applicationNo)}/photo`, { method: 'POST', credentials: 'include', body: form });
  const result = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(result.error || `Photo upload failed (${response.status}).`);
}
