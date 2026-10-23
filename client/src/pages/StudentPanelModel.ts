export type StudentAttendanceState = 'empty' | 'below-threshold' | 'normal';
export function studentAttendanceState(total: number, rate: number | null): StudentAttendanceState {
  if (!Number.isFinite(total) || total <= 0 || rate == null) return 'empty';
  return rate < 75 ? 'below-threshold' : 'normal';
}

export function summarizeStudentFees(rows: Array<{ total?: number; paid?: number }>) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, Number(row.total) || 0), 0);
  const paid = rows.reduce((sum, row) => sum + Math.max(0, Number(row.paid) || 0), 0);
  return { total, paid, due: Math.max(0, rows.reduce((sum, row) => sum + Math.max(0, Number(row.total) || 0) - Math.max(0, Number(row.paid) || 0), 0)) };
}

export function markStudentNoticesRead(previous: string[], noticeIds: string[]) {
  return Array.from(new Set([...previous, ...noticeIds].filter(Boolean)));
}
