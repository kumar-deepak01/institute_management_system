import { apiRequest } from './api';

export type ShiftTemplate = {
  id: string; name: string; code: string; workStart: string; workEnd: string;
  lateAfterMinutes: number; halfDayAfterMinutes: number; halfDayMinHours: number; fullDayMinHours: number;
};
export type ShiftStaff = { id: string; staffKey: string; name: string; email: string; role: string; staffType: string; employmentType: string };
export type ShiftAssignment = { staffKey: string; staffId: string; shiftId: string; assignedAt: string };
export type WorkShiftsData = { templates: ShiftTemplate[]; assignments: ShiftAssignment[]; staff: ShiftStaff[] };

export function workShiftsGet() { return apiRequest<WorkShiftsData>('/api/admin/work-shifts'); }
async function csrfHeaders() {
  const result = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': result.csrfToken };
}
export async function shiftTemplateCreate(input: Omit<ShiftTemplate, 'id'>) {
  return apiRequest<{ template: ShiftTemplate }>('/api/admin/work-shifts/templates', { method: 'POST', headers: await csrfHeaders(), body: input });
}
export async function shiftTemplateDelete(id: string) {
  return apiRequest<{ ok: boolean }>(`/api/admin/work-shifts/templates/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await csrfHeaders() });
}
export async function shiftsAssign(shiftId: string, staffKeys: string[]) {
  return apiRequest<{ assigned: number }>('/api/admin/work-shifts/assignments', { method: 'PUT', headers: await csrfHeaders(), body: { shiftId, staffKeys } });
}

export type FacultyPerformanceRecord = {
  staffKey: string; name: string; email: string; staffType: string; averageStudentScore: number;
  classesConducted: number; homeworkAssigned: number; homeworkCompletion: number; doubtsAnswered: number;
  performanceScore: number; batchIds: string[];
};
export type FacultyPerformanceData = {
  period: { month: number; year: number }; batches: { id: string; name: string }[];
  records: FacultyPerformanceRecord[]; summary: { faculty: number; averageScore: number };
};
export function facultyPerformanceGet(month: number, year: number, batchId: string) {
  const params = new URLSearchParams({ month: String(month), year: String(year), batchId });
  return apiRequest<FacultyPerformanceData>(`/api/admin/faculty-performance?${params.toString()}`);
}
