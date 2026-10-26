import { apiRequest } from './api';

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export interface ReportStats {
  students: number;
  revenue: string;
  rawRevenue: number;
  exams: number;
  attendance: string;
  feeCollectionRate: string;
  atRisk: number;
}

export interface FeeCollectionTransaction {
  id: string;
  studentName: string;
  admissionNumber: string;
  batch: string;
  feeTitle: string;
  principal: number;
  fine: number;
  method: string;
  date: string;
  recordedBy: string;
  receiptNo: string;
}

export interface FeeCollectionReportData {
  from: string;
  to: string;
  batchId: string;
  batches: Array<{ id: string; name: string }>;
  kpis: {
    totalCollected: number;
    transactions: number;
    avgTransaction: number;
    fineCollected: number;
  };
  byBatch: Array<{ batch: string; collected: number; txns: number }>;
  byMethod: Array<{ method: string; collected: number; txns: number }>;
  monthlyTrend: Array<{ month: string; amount: number; progressPct: number }>;
  transactions: FeeCollectionTransaction[];
}

export interface FeeDefaulterRecord {
  id: string;
  studentName: string;
  admissionNumber: string;
  phone: string;
  email: string;
  batchName: string;
  feeTitle: string;
  dueDate: string;
  daysOverdue: number;
  totalBilled: number;
  paidAmount: number;
  outstandingAmount: number;
}

export interface FeeDefaultersReportData {
  batches: Array<{ id: string; name: string }>;
  kpis: {
    defaultersCount: number;
    totalOverdue: number;
    avgOverdue: number;
  };
  records: FeeDefaulterRecord[];
}

export interface StudentSubjectRecord {
  id: string;
  name: string;
  admissionNumber: string;
  email: string;
  phone: string;
  batch: string;
  course: string;
  subjects: string;
}

export interface StudentSubjectsReportData {
  batches: Array<{ id: string; name: string }>;
  kpis: {
    totalStudents: number;
    withSubjects: number;
  };
  records: StudentSubjectRecord[];
}

export interface EnrollmentReportData {
  kpis: {
    totalAdmissions: number;
    totalBatches: number;
  };
  monthlyTrends: Array<{ month_label: string; month_key: string; count: number }>;
  batchStrengths: Array<{ batch_name: string; count: number }>;
}

export interface DropoutRecord {
  id: string;
  name: string;
  admissionNumber: string;
  email: string;
  phone: string;
  batch: string;
  status: string;
  joinedDate: string;
  dropDate: string;
}

export interface DropoutReportData {
  kpis: {
    dropoutsCount: number;
  };
  records: DropoutRecord[];
}

export interface RevenueRecord {
  monthKey: string;
  monthLabel: string;
  feeRevenue: number;
  otherIncome: number;
  totalRevenue: number;
  expense: number;
  netProfit: number;
}

export interface RevenueReportData {
  kpis: {
    totalFees: number;
    totalExpenses: number;
    netTotal: number;
  };
  records: RevenueRecord[];
}

export interface TransactionRecord {
  id: string;
  date: string;
  category: string;
  flow: 'Income' | 'Expense';
  amount: number;
  method: string;
  reference: string;
}

export interface TransactionReportData {
  kpis: {
    totalTransactions: number;
    totalInflow: number;
    totalOutflow: number;
    netFlow: number;
  };
  records: TransactionRecord[];
}

export interface CommunicationRecord {
  id: string;
  date: string;
  channel: string;
  recipient: string;
  content: string;
  status: string;
}

export interface CommunicationReportData {
  kpis: {
    totalSent: number;
    delivered: number;
  };
  records: CommunicationRecord[];
}

export interface AtRiskRecord {
  id: string;
  name: string;
  admissionNumber: string;
  phone: string;
  batch: string;
  riskLevel: string;
  attendanceRate: string;
  classesAttended: string;
}

export interface AtRiskReportData {
  kpis: {
    totalAtRisk: number;
    highRisk: number;
  };
  records: AtRiskRecord[];
}

export interface DeletedStudentRecord {
  id: string;
  name: string;
  admissionNumber: string;
  phone: string;
  email: string;
  batch: string;
  deletedAt: string;
}

export interface DeletedStudentsReportData {
  kpis: {
    deletedCount: number;
  };
  records: DeletedStudentRecord[];
}

// API Methods
export async function fetchReportStats(): Promise<ReportStats> {
  return apiRequest<ReportStats>('/api/admin/reports/stats');
}

export async function fetchFeeCollectionReport(from?: string, to?: string, batchId?: string): Promise<FeeCollectionReportData> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (batchId) params.set('batchId', batchId);
  const q = params.toString();
  return apiRequest<FeeCollectionReportData>(`/api/admin/reports/fees${q ? `?${q}` : ''}`);
}

export async function fetchFeeDefaultersReport(batchId?: string): Promise<FeeDefaultersReportData> {
  const q = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
  return apiRequest<FeeDefaultersReportData>(`/api/admin/reports/fee-defaulters${q}`);
}

export async function fetchStudentSubjectsReport(batchId?: string): Promise<StudentSubjectsReportData> {
  const q = batchId ? `?batchId=${encodeURIComponent(batchId)}` : '';
  return apiRequest<StudentSubjectsReportData>(`/api/admin/reports/student-subjects${q}`);
}

export async function fetchEnrollmentReport(): Promise<EnrollmentReportData> {
  return apiRequest<EnrollmentReportData>('/api/admin/reports/enrollment');
}

export async function fetchDropoutReport(): Promise<DropoutReportData> {
  return apiRequest<DropoutReportData>('/api/admin/reports/dropouts');
}

export async function fetchRevenueReport(): Promise<RevenueReportData> {
  return apiRequest<RevenueReportData>('/api/admin/reports/revenue');
}

export async function fetchTransactionReport(from?: string, to?: string, category?: string): Promise<TransactionReportData> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (category) params.set('category', category);
  const q = params.toString();
  return apiRequest<TransactionReportData>(`/api/admin/reports/transactions${q ? `?${q}` : ''}`);
}

export async function fetchCommunicationReport(): Promise<CommunicationReportData> {
  return apiRequest<CommunicationReportData>('/api/admin/reports/communication');
}

export async function fetchAtRiskReport(): Promise<AtRiskReportData> {
  return apiRequest<AtRiskReportData>('/api/admin/reports/at-risk');
}

export async function fetchDeletedStudentsReport(): Promise<DeletedStudentsReportData> {
  return apiRequest<DeletedStudentsReportData>('/api/admin/reports/deleted-students');
}

export async function downloadReportCsv(endpointPath: string, filename: string): Promise<void> {
  const response = await fetch(`${base}${endpointPath}`, { credentials: 'include' });
  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(errorJson.error || `Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

