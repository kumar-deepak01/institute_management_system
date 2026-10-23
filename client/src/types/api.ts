export interface ApiError { error: string }
export interface ApiOptions extends Omit<RequestInit, 'body'> { body?: unknown }
export interface Account { email: string; role: 'admin' | 'teacher' | 'student' | 'parent'; name: string; studentId?: string; mustChangePassword?: boolean }
export interface HealthResponse { ok: boolean }
export interface AdmissionConfig { open: boolean; instituteName: string; academicYear: string }
export interface AdmissionBatch { id: string; name: string; course: string }
export interface StudentRecord { id: string; name: string; email: string; roll: string; batchId: string; phone: string; status: 'Active' | 'Inactive'; joinedAt: string; studentId?: string; photo_path?: string | null; photo_updated_at?: string | null; photo_url?: string | null }
export interface StaffRecord { id: string; employeeId: string; name: string; email: string; phone: string; role: string; status: 'Active' | 'Inactive'; photo_path?: string | null; photo_updated_at?: string | null; photo_url?: string | null }
export type ProfilePhotoType = 'students' | 'staff';
export interface PhotoMutationResponse { ok: boolean; photo_path: string | null; photo_updated_at: string | null; photo_url?: string | null; size?: number }
export interface BatchRecord { id: string; name: string; course: string; teacher: string; students: number }
export interface AdmissionApplication { id: string; applicationNo: string; name: string; email: string; mobile: string; batchId: string; batchName: string; status: 'Pending' | 'Under Review' | 'Approved' | 'Rejected'; appliedAt: string; previousYearPercent?: number | ''; photo?: string; adminNotes?: string; rejectReason?: string; studentId?: string | null; student?: { id: string; name?: string }; statusHistory?: Array<{ status: string; at: string; reason?: string }> }
export interface RecordResponse<T> { records: T[] }
