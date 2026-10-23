import { apiRequest } from './api';

export type CurriculumEntity = 'academic-years' | 'courses' | 'subjects' | 'topics' | 'batches';
export interface CurriculumRecord {
  id: string; name: string; status: string; updatedAt?: string | null;
  startDate?: string; endDate?: string; description?: string; courseId?: string; courseName?: string;
  duration?: string; batchCount?: number; studentCount?: number; teacherId?: string; teacherName?: string; schedule?: string;
  subjectId?: string; subjectName?: string; academicYearId?: string; active?: boolean; capacity?: number;
}
export interface CurriculumLookups {
  courses: Array<{ id: string; name: string; status?: string }>;
  subjects: Array<{ id: string; name: string; course_id?: string | null; status?: string }>;
  batches: Array<{ id: string; name: string; course_id?: string | null; course_name?: string | null; active?: boolean | null }>;
  academicYears: Array<{ id: string; name: string; status?: string; startDate?: string | null; endDate?: string | null }>;
  teachers: Array<{ id: string; name: string }>;
  schemaPending?: boolean;
}
export interface CurriculumList { records: CurriculumRecord[]; total: number; page: number; limit: number; pages: number; schemaPending?: boolean }
export interface BatchOverview { record: CurriculumRecord; metrics: { studentCount: number; capacity: number; weeklyClasses: number; exams: number }; students: Array<{ id: string; studentId: string; name: string; status: string; risk: 'Low' | 'Medium' | 'High'; attendanceRate: number | null }> }

async function csrfHeaders(): Promise<Record<string, string>> {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export const getCurriculumLookups = () => apiRequest<CurriculumLookups>('/api/admin/curriculum/lookups');
export const getCurriculumStats = () => apiRequest<Record<string, number> & { schemaPending?: boolean }>('/api/admin/curriculum/stats');
export const getBatchOverview = (id: string) => apiRequest<BatchOverview>(`/api/admin/curriculum/batches/${encodeURIComponent(id)}/overview`);
export function getCurriculumRecords(entity: CurriculumEntity, options: { q?: string; status?: string; parent?: string; academicYear?: string; page?: number; limit?: number }): Promise<CurriculumList> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) if (value) query.set(key, String(value));
  return apiRequest<CurriculumList>(`/api/admin/curriculum/${entity}?${query.toString()}`);
}
export async function saveCurriculumRecord(entity: CurriculumEntity, record: Partial<CurriculumRecord>, id?: string): Promise<CurriculumRecord> {
  const result = await apiRequest<{ record: CurriculumRecord }>(`/api/admin/curriculum/${entity}${id ? `/${encodeURIComponent(id)}` : ''}`, {
    method: id ? 'PATCH' : 'POST', headers: await csrfHeaders(), body: record,
  });
  return result.record;
}
