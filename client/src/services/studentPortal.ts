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
  subjectAttendance?: Array<{ id: string; name: string; teacher: string; held: number; attended: number; missed: number; rate: number; enrolled: boolean }>;
  classLog?: Array<{ id: string; date: string; subjectName: string; teacherName: string; time: string; status: string; joinTime?: string }>;
  demoWhatsAppNumber?: string;
};
export type StudentPortalResponse = { profile: StudentPortalProfile; data: StudentPortalData; config?: { demoWhatsAppNumber?: string }; panelErrors: string[] };
export const getStudentPortal = (month?: string) => apiRequest<StudentPortalResponse>(`/api/student/portal${month ? `?month=${encodeURIComponent(month)}` : ''}`);
export const joinLiveClass = (classId: string) => apiRequest<{ ok: boolean; message: string; meetingUrl: string; subjectName: string; date: string; time: string }>(`/api/student/live-classes/${encodeURIComponent(classId)}/join`, { method: 'POST' });
