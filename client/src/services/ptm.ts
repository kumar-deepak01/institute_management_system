import { apiRequest } from './api';

async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export type PtmSession = {
  id: string; title: string; notes: string; provider: 'zoom'|'google_meet'|'in_person'; batch_id: string; batch_name: string;
  teacher_staff_id: string; teacher_name: string; audience: 'parents'|'students_and_parents'; scheduled_at: string;
  duration_minutes: number; status: 'scheduled'|'cancelled'; join_url?: string | null; host_url?: string | null; recipientCount?: number;
};
export type PtmLookups = { sessions: PtmSession[]; batches: { id: string; name: string }[]; teachers: { id: string; name: string; staff_type: string }[] };
export type PtmInput = { title: string; notes: string; provider: PtmSession['provider']; batchId: string; teacherId: string; audience: PtmSession['audience']; scheduledAt: string; durationMinutes: number };
export const getPtmSessions = () => apiRequest<PtmLookups>('/api/admin/ptm');
export const createPtmSession = async (input: PtmInput) => apiRequest<{session:PtmSession}>('/api/admin/ptm', { method:'POST', headers: await csrfHeaders(), body:input });
export const updatePtmSession = async (id:string,input:PtmInput) => apiRequest<{ok:boolean}>(`/api/admin/ptm/${encodeURIComponent(id)}`, { method:'PATCH', headers:await csrfHeaders(), body:input });
export const cancelPtmSession = async (id:string) => apiRequest<{ok:boolean}>(`/api/admin/ptm/${encodeURIComponent(id)}`, { method:'DELETE', headers:await csrfHeaders() });
export type PtmNotice = { id:string; session_id:string; recipient_role:'student'|'parent'|'teacher'; title:string; notes:string; provider:string; batch_name:string; teacher_name:string; scheduled_at:string; duration_minutes:number; status:'scheduled'|'cancelled'; meeting_url:string|null };
export const getPtmNotices = () => apiRequest<{meetings:PtmNotice[]}>('/api/portal/ptm');
