import { apiRequest } from './api';

export type StudentPortalProfile = {
  id: string; studentId: string; admissionNumber: string; name: string; email: string; phone: string;
  batchId: string; batchName: string; courseName: string; joinedAt: string; dateOfBirth: string;
  photoUrl: string; subjects: string[]; status: string;
};
export type StudentPortalData = {
  attendance: Array<Record<string, any>>; attendanceSummary: { present: number; absent: number; late: number; excused: number; total: number; rate: number | null };
  timetable: Array<Record<string, any>>; exams: Array<Record<string, any>>; results: Array<Record<string, any>>;
  homework: Array<Record<string, any>>; fees: Array<Record<string, any>>; downloads: Array<Record<string, any>>;
  videos: Array<Record<string, any>>; liveClasses: Array<Record<string, any>>; subjects: Array<{ id: string; name: string }>;
};
export type StudentPortalResponse = { profile: StudentPortalProfile; data: StudentPortalData; panelErrors: string[] };
export const getStudentPortal = (month?: string) => apiRequest<StudentPortalResponse>(`/api/student/portal${month ? `?month=${encodeURIComponent(month)}` : ''}`);
