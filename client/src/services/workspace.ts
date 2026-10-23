import { apiRequest } from './api';

async function csrfHeaders(): Promise<Record<string, string>> {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export interface TeacherAssignment { id: string; title: string; batch: string; batchId: string; due: string; status: string }
export async function listTeacherAssignments(): Promise<TeacherAssignment[]> {
  return (await apiRequest<{ assignments: TeacherAssignment[] }>('/api/teacher/assignments')).assignments;
}
export async function listTeacherAttendance(): Promise<Array<{ date: string; roll: string; status: string }>> {
  return (await apiRequest<{ records: Array<{ date: string; roll: string; status: string }> }>('/api/teacher/attendance')).records;
}
export async function createTeacherAssignment(input: Pick<TeacherAssignment, 'title' | 'batch' | 'batchId' | 'due'>): Promise<TeacherAssignment> {
  return (await apiRequest<{ assignment: TeacherAssignment }>('/api/teacher/assignments', { method: 'POST', headers: await csrfHeaders(), body: input })).assignment;
}
export async function saveTeacherAttendance(records: Array<{ date: string; roll: string; status: string }>): Promise<void> {
  await apiRequest('/api/teacher/attendance', { method: 'POST', headers: await csrfHeaders(), body: { records } });
}
export async function sendTeacherMessage(body: string): Promise<void> {
  await apiRequest('/api/teacher/messages', { method: 'POST', headers: await csrfHeaders(), body: { body } });
}
export async function submitStudentAssignment(assignmentId: string): Promise<void> {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  await apiRequest('/api/student/assignment-submissions', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: { assignmentId } });
}
export async function listStudentSubmissions(): Promise<string[]> {
  const { submissions } = await apiRequest<{ submissions: Array<{ assignmentId: string }> }>('/api/student/assignment-submissions');
  return submissions.map(item => item.assignmentId);
}
export interface InstituteSettings { instituteName: string; academicYear: string; contactEmail: string; timezone: string }
export async function getInstituteSettings(adminToken?: string): Promise<InstituteSettings> {
  const headers = adminToken ? { 'X-Admission-Admin-Token': adminToken } : undefined;
  return (await apiRequest<{ settings: InstituteSettings }>('/api/settings', { headers })).settings;
}
export async function updateInstituteSettings(settings: InstituteSettings, adminToken?: string): Promise<void> {
  const headers: Record<string, string> = adminToken ? { 'X-Admission-Admin-Token': adminToken } : {};
  if (!adminToken) { const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf'); headers['X-CSRF-Token'] = csrfToken; }
  await apiRequest('/api/settings', { method: 'PUT', headers, body: settings });
}
