import { apiRequest } from './api';

export type PayrollStaff = {
  id: string; staffKey: string; employeeId: string; name: string; email: string; role: string; employmentType: string;
  model: 'monthly' | 'hourly' | 'per_class' | 'per_hour' | 'hybrid'; profileSet: boolean;
  monthlyRate: number; hourlyRate: number; classRate: number; teachingHourRate: number; allowance: number;
  presentDays: number; absentDays: number; paidLeaveDays?: number; unpaidLeaveDays?: number; recordedAttendanceDays: number; attendancePercent: number | null;
  approvedMinutes: number; payableHours: number; approvedClasses: number; pendingWorkRecords: number;
  baseEarnings: number; teachingEarnings: number; otherEarnings: number; otherDeductions: number; advanceRecovery: number;
  grossPay: number; totalDeductions: number; netPay: number; warnings?: string[]; eligible?: boolean;
};
export type PayrollDashboard = {
  period: { month: number; year: number; start: string; end: string; key: string };
  stats: { totalStaff: number; profilesSetUp: number; workingDays: number; settledAmount: number };
  run: null | { id: string; status: string; reviewRequired: boolean; reviewReason: string; staffCount: number; grossTotal: number; deductionTotal: number; netTotal: number; approvedAt?: string; finalizedAt?: string; settledAt?: string; paymentDate?: string };
  staff: PayrollStaff[]; history: Array<{ id: string; periodStart: string; periodEnd: string; status: string; staffCount: number; grossTotal: number; deductionTotal: number; netTotal: number; settledAt?: string }>;
  advances: Array<{ id: string; staffId: string; amount: number; repaymentAmount: number; balance: number; reason: string }>;
  zoom: { configured: boolean; webhookReady: boolean }; schemaPending?: boolean; error?: string;
};
export type StaffAttendanceStatus = 'present' | 'late' | 'half_day' | 'leave' | 'absent' | 'holiday';
export type StaffAttendanceDay = { status: StaffAttendanceStatus; checkIn: string; checkOut: string; minutes: number; overtimeMinutes: number; recordStatus: string };
export type StaffAttendancePerson = { id: string; staffKey: string; employeeId: string; name: string; email: string; type: string; employmentType: string; days: Record<string, StaffAttendanceDay> };
export type StaffAttendanceData = { period: { month: number; year: number; start: string; end: string; key: string }; workdays: number; staff: StaffAttendancePerson[]; stats: { totalStaff: number; avgAttendance: number; lateCheckIns: number; overtimeHours: number }; schemaPending?: boolean };
const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
async function csrfHeaders() {
  const { csrfToken } = await apiRequest<{ csrfToken: string }>('/api/auth/csrf');
  return { 'X-CSRF-Token': csrfToken };
}
export async function payrollGet<T>(path = '', fresh = false): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  return apiRequest<T>(`/api/admin/payroll${path}${fresh ? `${separator}fresh=1` : ''}`);
}
export async function payrollWrite<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown): Promise<T> {
  return apiRequest<T>(`/api/admin/payroll${path}`, { method, headers: await csrfHeaders(), body });
}
export async function payrollDownload(path: string, filename: string) {
  const response = await fetch(`${base}/api/admin/payroll${path}`, { credentials: 'include' });
  if (!response.ok) { const value = await response.json().catch(() => ({})) as { error?: string }; throw new Error(value.error || `Export failed (${response.status}).`); }
  const link = document.createElement('a'); const href = URL.createObjectURL(await response.blob());
  link.href = href; link.download = filename; link.click(); URL.revokeObjectURL(href);
}
export async function staffAttendanceGet(month: number, year: number): Promise<StaffAttendanceData> {
  return payrollGet<StaffAttendanceData>(`/staff-attendance?month=${month}&year=${year}`);
}
export async function staffAttendanceSave(date: string, records: Array<{ staffId: string; status: StaffAttendanceStatus; checkIn: string; checkOut: string; overtimeMinutes: number }>) {
  return payrollWrite<{ saved: number; date: string }>(`/staff-attendance?date=${encodeURIComponent(date)}`, 'POST', { records });
}
