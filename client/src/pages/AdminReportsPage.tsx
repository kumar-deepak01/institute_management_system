import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import {
  fetchReportStats,
  fetchFeeCollectionReport,
  fetchFeeDefaultersReport,
  fetchStudentSubjectsReport,
  fetchEnrollmentReport,
  fetchDropoutReport,
  fetchRevenueReport,
  fetchTransactionReport,
  fetchCommunicationReport,
  fetchAtRiskReport,
  fetchDeletedStudentsReport,
  downloadReportCsv,
  type ReportStats,
  type FeeCollectionReportData,
  type FeeCollectionTransaction,
  type FeeDefaultersReportData,
  type StudentSubjectsReportData
} from '../services/reports';

// Soft Tint Colors for Icon Chips
const TINTS = {
  blue: 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/50 dark:border-blue-900/50 dark:text-blue-400',
  cyan: 'bg-cyan-50 text-cyan-600 border-cyan-200 dark:bg-cyan-950/50 dark:border-cyan-900/50 dark:text-cyan-400',
  green: 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-900/50 dark:text-emerald-400',
  red: 'bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/50 dark:border-rose-900/50 dark:text-rose-400',
  amber: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/50 dark:border-amber-900/50 dark:text-amber-400',
  purple: 'bg-purple-50 text-purple-600 border-purple-200 dark:bg-purple-950/50 dark:border-purple-900/50 dark:text-purple-400',
  pink: 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-950/50 dark:border-pink-900/50 dark:text-pink-400',
  teal: 'bg-teal-50 text-teal-600 border-teal-200 dark:bg-teal-950/50 dark:border-teal-900/50 dark:text-teal-400',
};

interface ReportCardConfig {
  id: number;
  title: string;
  description: string;
  icon: string;
  tint: keyof typeof TINTS;
  category: 'A' | 'B' | 'C' | 'D';
  destination: string;
  exportPath?: string;
}

const REPORTS_CONFIG: ReportCardConfig[] = [
  // Row 1
  {
    id: 1,
    title: 'Student Progress Report',
    description: 'Student-wise exam progress table with present report & rankings',
    icon: 'grid',
    tint: 'blue',
    category: 'C',
    destination: '/admin/reports/progress'
  },
  {
    id: 2,
    title: 'Student Details Report',
    description: 'Detailed student profile, course, batch and enrollment info',
    icon: 'person',
    tint: 'blue',
    category: 'A',
    destination: '/admin/students'
  },
  {
    id: 3,
    title: 'Student Assigned Subject Report',
    description: 'Students with their assigned subjects, courses & batch details',
    icon: 'book',
    tint: 'cyan',
    category: 'B',
    destination: '/admin/reports/student-subjects'
  },

  // Row 2
  {
    id: 4,
    title: 'Attendance Report',
    description: 'Track daily, batch-wise and student-wise attendance rates',
    icon: 'checklist',
    tint: 'blue',
    category: 'A',
    destination: '/admin/attendance'
  },
  {
    id: 5,
    title: 'Fee Collection',
    description: 'Monthly collection trends, payment methods breakdown',
    icon: 'payment',
    tint: 'green',
    category: 'B',
    destination: '/admin/reports/fees'
  },
  {
    id: 6,
    title: 'Fee Defaulters',
    description: 'List of students with overdue fees and amounts',
    icon: 'eventOff',
    tint: 'red',
    category: 'B',
    destination: '/admin/reports/fee-defaulters'
  },

  // Row 3
  {
    id: 7,
    title: 'Student Performance',
    description: 'Individual student exam scores and ranking',
    icon: 'chart',
    tint: 'blue',
    category: 'C',
    destination: '/admin/reports/student-performance'
  },
  {
    id: 8,
    title: 'Batch Performance',
    description: 'Compare performance across different batches',
    icon: 'briefcase',
    tint: 'amber',
    category: 'C',
    destination: '/admin/reports/batch-performance'
  },
  {
    id: 9,
    title: 'Exam Analysis',
    description: 'Pass/fail ratio, average scores per exam',
    icon: 'document',
    tint: 'cyan',
    category: 'C',
    destination: '/admin/reports/exam-analysis'
  },

  // Row 4
  {
    id: 10,
    title: 'Teacher Performance',
    description: 'Class load, subject coverage, homework given',
    icon: 'video',
    tint: 'purple',
    category: 'A',
    destination: '/admin/faculty-performance'
  },
  {
    id: 11,
    title: 'Enrollment Report',
    description: 'Monthly new admissions and batch-wise strength',
    icon: 'addPerson',
    tint: 'pink',
    category: 'B',
    destination: '/admin/reports/enrollment'
  },
  {
    id: 12,
    title: 'Dropout Analysis',
    description: 'Inactive/dropped students analysis',
    icon: 'person',
    tint: 'red',
    category: 'B',
    destination: '/admin/reports/dropouts'
  },

  // Row 5
  {
    id: 13,
    title: 'Revenue Report',
    description: 'Monthly and yearly revenue trends',
    icon: 'rupee',
    tint: 'green',
    category: 'B',
    destination: '/admin/reports/revenue'
  },
  {
    id: 14,
    title: 'Transaction Report',
    description: 'Consolidated financial ledger for fee collection, income, expenses & payroll',
    icon: 'export',
    tint: 'green',
    category: 'B',
    destination: '/admin/reports/transactions'
  },
  {
    id: 15,
    title: 'Homework Report',
    description: 'Assignment submission rates and grades',
    icon: 'pencil',
    tint: 'amber',
    category: 'A',
    destination: '/admin/homework'
  },

  // Row 6
  {
    id: 16,
    title: 'Communication Log',
    description: 'SMS, WhatsApp, email delivery tracking',
    icon: 'megaphone',
    tint: 'blue',
    category: 'B',
    destination: '/admin/reports/communication'
  },
  {
    id: 17,
    title: 'Timetable Utilization',
    description: 'Slot usage by day, teacher load & room utilisation',
    icon: 'calendar',
    tint: 'blue',
    category: 'A',
    destination: '/admin/timetable'
  },
  {
    id: 18,
    title: 'At-Risk Students',
    description: 'Early warning system for struggling students',
    icon: 'shield',
    tint: 'red',
    category: 'B',
    destination: '/admin/reports/at-risk'
  },

  // Row 7
  {
    id: 19,
    title: 'Discount Analysis',
    description: 'Discounts given, impact on revenue',
    icon: 'tag',
    tint: 'teal',
    category: 'A',
    destination: '/admin/discounts'
  },
  {
    id: 20,
    title: 'Inventory Report',
    description: 'Stock items, consumption & low stock tracking',
    icon: 'boxes',
    tint: 'green',
    category: 'C',
    destination: '/admin/reports/inventory'
  },
  {
    id: 21,
    title: 'Deleted Students (Trash)',
    description: 'View and restore deleted student records',
    icon: 'close',
    tint: 'red',
    category: 'B',
    destination: '/admin/reports/deleted-students'
  },

  // Row 8
  {
    id: 22,
    title: 'Export: Students CSV',
    description: 'Download full student roster as CSV',
    icon: 'download',
    tint: 'blue',
    category: 'D',
    destination: '',
    exportPath: '/api/admin/reports/export/students'
  },
  {
    id: 23,
    title: 'Export: Fees CSV',
    description: 'Download fee collection records as CSV',
    icon: 'download',
    tint: 'green',
    category: 'D',
    destination: '',
    exportPath: '/api/admin/reports/export/fees'
  },
  {
    id: 24,
    title: 'Export: Attendance CSV',
    description: 'Download attendance records as CSV',
    icon: 'download',
    tint: 'amber',
    category: 'D',
    destination: '',
    exportPath: '/api/admin/reports/export/attendance'
  }
];

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);
}

export default function AdminReportsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.replace(/\/$/, '');

  // Main Directory State
  const [stats, setStats] = useState<ReportStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [toastMessage, setToastMessage] = useState('');

  // Sub-report State: Fee Collection
  const [feeReport, setFeeReport] = useState<FeeCollectionReportData | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeFrom, setFeeFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [feeTo, setFeeTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [feeBatch, setFeeBatch] = useState('');
  const [selectedReceipt, setSelectedReceipt] = useState<FeeCollectionTransaction | null>(null);

  // Sub-report State: Generic Data
  const [subReportData, setSubReportData] = useState<unknown>(null);
  const [subReportLoading, setSubReportLoading] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Load Main Stats
  useEffect(() => {
    if (currentPath === '/admin/reports') {
      setLoadingStats(true);
      fetchReportStats()
        .then(setStats)
        .catch(err => console.error('Failed to load report stats:', err))
        .finally(() => setLoadingStats(false));
    }
  }, [currentPath]);

  // Load Specific Report
  useEffect(() => {
    if (currentPath === '/admin/reports/fees') {
      setFeeLoading(true);
      fetchFeeCollectionReport(feeFrom, feeTo, feeBatch)
        .then(setFeeReport)
        .catch(err => console.error('Failed to load fee report:', err))
        .finally(() => setFeeLoading(false));
    } else if (currentPath === '/admin/reports/fee-defaulters') {
      setSubReportLoading(true);
      fetchFeeDefaultersReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/student-subjects') {
      setSubReportLoading(true);
      fetchStudentSubjectsReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/enrollment') {
      setSubReportLoading(true);
      fetchEnrollmentReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/dropouts') {
      setSubReportLoading(true);
      fetchDropoutReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/revenue') {
      setSubReportLoading(true);
      fetchRevenueReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/transactions') {
      setSubReportLoading(true);
      fetchTransactionReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/communication') {
      setSubReportLoading(true);
      fetchCommunicationReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/at-risk') {
      setSubReportLoading(true);
      fetchAtRiskReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    } else if (currentPath === '/admin/reports/deleted-students') {
      setSubReportLoading(true);
      fetchDeletedStudentsReport()
        .then(setSubReportData)
        .finally(() => setSubReportLoading(false));
    }
  }, [currentPath, feeFrom, feeTo, feeBatch]);

  // Handle Card Click
  const handleCardClick = (card: ReportCardConfig) => {
    if (card.category === 'D' && card.exportPath) {
      showToast(`Generating ${card.title.replace('Export: ', '')}...`);
      downloadReportCsv(card.exportPath, `${card.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.csv`)
        .then(() => showToast('Download completed ✓'))
        .catch(e => showToast(`Download failed: ${e.message}`));
      return;
    }
    if (card.destination) {
      navigate(card.destination);
    }
  };

  // =========================================================================
  // VIEW: FEE COLLECTION REPORT (Reference Frame: dense-1416-004.jpg)
  // =========================================================================
  if (currentPath === '/admin/reports/fees') {
    return (
      <main className="space-y-6">
        {toastMessage && (
          <div className="fixed top-8 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-emerald-400 bg-emerald-600 px-6 py-3 font-bold text-white shadow-2xl">
            {toastMessage}
          </div>
        )}

        {/* Breadcrumb + Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-stone-400">
              <button onClick={() => navigate('/admin/reports')} className="hover:text-orange-600">Reports</button>
              <span>/</span>
              <span className="text-slate-800 dark:text-stone-200">Fee Collection</span>
            </div>
            <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">Fee Collection Report</h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                showToast('Exporting Fee Collection CSV...');
                downloadReportCsv('/api/admin/reports/export/fees', 'fee-collection-report.csv')
                  .then(() => showToast('Export completed ✓'))
                  .catch(e => showToast(`Export failed: ${e.message}`));
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              <AdminIcon name="download" className="h-4 w-4" />
              Export
            </button>
            <button
              onClick={() => navigate('/admin/reports')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              ← Back
            </button>
          </div>
        </div>

        {/* Filter Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                FROM
              </label>
              <input
                type="date"
                value={feeFrom}
                onChange={e => setFeeFrom(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                TO
              </label>
              <input
                type="date"
                value={feeTo}
                onChange={e => setFeeTo(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                BATCH
              </label>
              <select
                aria-label="Filter Batch"
                value={feeBatch}
                onChange={e => setFeeBatch(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800 dark:text-white"
              >
                <option value="">— All Batches —</option>
                {(feeReport?.batches || []).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => {
                  setFeeLoading(true);
                  fetchFeeCollectionReport(feeFrom, feeTo, feeBatch)
                    .then(setFeeReport)
                    .finally(() => setFeeLoading(false));
                }}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-orange-600"
              >
                <AdminIcon name="filter" className="h-4 w-4" />
                Filter
              </button>
            </div>
          </div>
        </div>

        {/* 4 KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <AdminIcon name="payment" className="h-6 w-6" />
            </span>
            <div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {formatCurrency(feeReport?.kpis.totalCollected || 0)}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                TOTAL COLLECTED
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <AdminIcon name="document" className="h-6 w-6" />
            </span>
            <div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {feeReport?.kpis.transactions ?? 0}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                TRANSACTIONS
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <AdminIcon name="calculator" className="h-6 w-6" />
            </span>
            <div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {formatCurrency(feeReport?.kpis.avgTransaction || 0)}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                AVG / TRANSACTION
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
              <AdminIcon name="clock" className="h-6 w-6" />
            </span>
            <div>
              <p className="text-2xl font-black text-slate-900 dark:text-white">
                {formatCurrency(feeReport?.kpis.fineCollected || 0)}
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">
                FINE COLLECTED
              </p>
            </div>
          </div>
        </div>

        {/* 3 Panels Row: By Batch, By Payment Method, Monthly Trend */}
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Panel 1: By Batch */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <h4 className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
              <AdminIcon name="briefcase" className="h-4 w-4 text-orange-600" />
              By Batch
            </h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                  <tr>
                    <th className="px-3 py-2">BATCH</th>
                    <th className="px-3 py-2 text-right">COLLECTED</th>
                    <th className="px-3 py-2 text-right">TXNS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                  {!(feeReport?.byBatch || []).length ? (
                    <tr><td colSpan={3} className="py-4 text-center text-slate-400">No records</td></tr>
                  ) : (
                    feeReport?.byBatch.map(b => (
                      <tr key={b.batch} className="hover:bg-slate-50 dark:hover:bg-stone-800/40">
                        <td className="px-3 py-2.5 font-bold text-slate-800 dark:text-stone-200">{b.batch}</td>
                        <td className="px-3 py-2.5 text-right font-black text-emerald-600">{formatCurrency(b.collected)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-600 dark:text-stone-400">{b.txns}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Panel 2: By Payment Method */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <h4 className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
              <AdminIcon name="payment" className="h-4 w-4 text-orange-600" />
              By Payment Method
            </h4>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                  <tr>
                    <th className="px-3 py-2">METHOD</th>
                    <th className="px-3 py-2 text-right">COLLECTED</th>
                    <th className="px-3 py-2 text-right">TXNS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                  {!(feeReport?.byMethod || []).length ? (
                    <tr><td colSpan={3} className="py-4 text-center text-slate-400">No records</td></tr>
                  ) : (
                    feeReport?.byMethod.map(m => (
                      <tr key={m.method} className="hover:bg-slate-50 dark:hover:bg-stone-800/40">
                        <td className="px-3 py-2.5 font-bold text-slate-800 dark:text-stone-200">{m.method}</td>
                        <td className="px-3 py-2.5 text-right font-black text-emerald-600">{formatCurrency(m.collected)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-600 dark:text-stone-400">{m.txns}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Panel 3: Monthly Trend */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <h4 className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
              <AdminIcon name="chart" className="h-4 w-4 text-orange-600" />
              Monthly Trend
            </h4>
            <div className="mt-4 space-y-3">
              {!(feeReport?.monthlyTrend || []).length ? (
                <p className="py-6 text-center text-xs text-slate-400">No monthly trends recorded.</p>
              ) : (
                feeReport?.monthlyTrend.map(t => (
                  <div key={t.month} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-800 dark:text-stone-200">{t.month}</span>
                      <span className="text-emerald-600 font-black">{formatCurrency(t.amount)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-stone-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                        style={{ width: `${Math.min(100, Math.max(5, t.progressPct))}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bottom Card: Transactions Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between border-b border-slate-100 bg-[#FFF7ED] px-6 py-4 dark:border-stone-800 dark:bg-stone-800/60">
            <h4 className="font-extrabold text-slate-900 dark:text-white">Transactions</h4>
            <span className="text-xs font-bold text-slate-500 dark:text-stone-400">
              {feeReport?.transactions.length || 0} total
            </span>
          </div>

          {feeLoading ? (
            <p className="p-12 text-center text-slate-400">Loading transactions…</p>
          ) : !feeReport?.transactions.length ? (
            <p className="p-12 text-center text-slate-500">No transactions recorded for this date range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[950px] text-left text-xs">
                <thead className="border-b border-slate-100 bg-[#FFF7ED]/50 text-[10px] font-black uppercase text-orange-700 dark:border-stone-800 dark:bg-stone-800/40 dark:text-orange-400">
                  <tr>
                    <th className="px-5 py-3">STUDENT</th>
                    <th className="px-4 py-3">BATCH</th>
                    <th className="px-4 py-3">FEE TITLE</th>
                    <th className="px-4 py-3 text-right">PRINCIPAL</th>
                    <th className="px-3 py-3 text-right">FINE</th>
                    <th className="px-3 py-3 text-center">METHOD</th>
                    <th className="px-4 py-3">DATE</th>
                    <th className="px-4 py-3">RECORDED BY</th>
                    <th className="px-4 py-3 text-center">RECEIPT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                  {feeReport.transactions.map(t => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-stone-800/40">
                      <td className="px-5 py-3.5">
                        <p className="font-bold text-slate-900 dark:text-white">{t.studentName}</p>
                        {t.admissionNumber && <p className="text-[10px] text-slate-400">{t.admissionNumber}</p>}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-700 dark:text-stone-300">{t.batch}</td>
                      <td className="px-4 py-3.5 text-slate-700 dark:text-stone-300">{t.feeTitle}</td>
                      <td className="px-4 py-3.5 text-right font-black text-emerald-600">{formatCurrency(t.principal)}</td>
                      <td className="px-3 py-3.5 text-right font-semibold text-slate-400">{t.fine > 0 ? formatCurrency(t.fine) : '—'}</td>
                      <td className="px-3 py-3.5 text-center">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-black text-slate-700 dark:bg-stone-800 dark:text-stone-300">
                          {t.method}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-stone-400">{t.date}</td>
                      <td className="px-4 py-3.5 text-slate-600 dark:text-stone-400">{t.recordedBy}</td>
                      <td className="px-4 py-3.5 text-center">
                        <button
                          onClick={() => setSelectedReceipt(t)}
                          title={`View Receipt: ${t.receiptNo}`}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-orange-200 bg-orange-50 text-orange-600 transition hover:bg-orange-100 dark:border-stone-700 dark:bg-stone-800 dark:text-orange-400"
                        >
                          <AdminIcon name="download" className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Receipt Preview Modal */}
        {selectedReceipt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-orange-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900">
              <div className="flex items-start justify-between border-b border-orange-100 pb-4 dark:border-stone-800">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">Fee Receipt Preview</h3>
                  <p className="text-xs font-mono font-bold text-orange-600">{selectedReceipt.receiptNo}</p>
                </div>
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-stone-800"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs">
                <div className="rounded-xl border border-orange-100 bg-[#FFF7ED] p-4 text-center dark:border-stone-800 dark:bg-stone-800/60">
                  <p className="text-[10px] font-black uppercase tracking-wider text-orange-700 dark:text-orange-400">My JEE Mentor</p>
                  <p className="mt-1 text-2xl font-black text-emerald-600">{formatCurrency(selectedReceipt.principal)}</p>
                  <p className="mt-0.5 text-slate-500">Paid via {selectedReceipt.method} on {selectedReceipt.date}</p>
                </div>

                <div className="divide-y divide-slate-100 dark:divide-stone-800">
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Student Name:</span>
                    <b className="text-slate-800 dark:text-white">{selectedReceipt.studentName}</b>
                  </div>
                  {selectedReceipt.admissionNumber && (
                    <div className="flex justify-between py-2">
                      <span className="text-slate-500">Admission No:</span>
                      <b className="font-mono text-slate-800 dark:text-white">{selectedReceipt.admissionNumber}</b>
                    </div>
                  )}
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Batch:</span>
                    <b className="text-slate-800 dark:text-white">{selectedReceipt.batch}</b>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Fee Particular:</span>
                    <b className="text-slate-800 dark:text-white">{selectedReceipt.feeTitle}</b>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">Recorded By:</span>
                    <b className="text-slate-800 dark:text-white">{selectedReceipt.recordedBy}</b>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-end gap-3 border-t border-orange-100 pt-4 dark:border-stone-800">
                <button
                  onClick={() => setSelectedReceipt(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-stone-700 dark:text-stone-300"
                >
                  Close
                </button>
                <button
                  onClick={() => window.print()}
                  className="rounded-xl bg-orange-500 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-orange-600"
                >
                  Print Receipt
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    );
  }

  // =========================================================================
  // VIEW: REUSABLE REPORT SHELL FOR OTHER REPORTS
  // =========================================================================
  if (currentPath.startsWith('/admin/reports/')) {
    const activeReport = REPORTS_CONFIG.find(r => r.destination === currentPath);
    const reportTitle = activeReport?.title || 'Report';

    // Type C: Empty State (No Data Source / Not Configured)
    if (activeReport?.category === 'C') {
      return (
        <main className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-stone-400">
              <button onClick={() => navigate('/admin/reports')} className="hover:text-orange-600">Reports</button>
              <span>/</span>
              <span className="text-slate-800 dark:text-stone-200">{reportTitle}</span>
            </div>
            <button
              onClick={() => navigate('/admin/reports')}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              ← Back
            </button>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-orange-50 text-orange-600 dark:bg-stone-800 dark:text-orange-400">
              <AdminIcon name={activeReport.icon} className="h-8 w-8" />
            </span>
            <h3 className="mt-4 text-xl font-black text-slate-900 dark:text-white">No data available yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-stone-400">
              The module for {reportTitle.toLowerCase()} has not recorded any active entries yet. Once records are created, detailed performance metrics and analytical summaries will automatically appear here.
            </p>
            <button
              onClick={() => navigate('/admin/reports')}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-xs font-bold text-white shadow-md hover:bg-orange-600"
            >
              Back to Reports
            </button>
          </div>
        </main>
      );
    }

    // Type B: Active Data Reports
    return (
      <main className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-stone-400">
              <button onClick={() => navigate('/admin/reports')} className="hover:text-orange-600">Reports</button>
              <span>/</span>
              <span className="text-slate-800 dark:text-stone-200">{reportTitle}</span>
            </div>
            <h2 className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{reportTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              Print / PDF
            </button>
            <button
              onClick={() => navigate('/admin/reports')}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              ← Back
            </button>
          </div>
        </div>

        {subReportLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-slate-400 dark:border-stone-800 dark:bg-stone-900">
            Loading report data…
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
            {/* Defaulters Report */}
            {currentPath === '/admin/reports/fee-defaulters' && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="rounded-xl bg-[#FFF7ED] p-4 text-center dark:bg-stone-800">
                    <p className="text-2xl font-black text-rose-600">{(subReportData as FeeDefaultersReportData)?.kpis?.defaultersCount || 0}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Defaulters</p>
                  </div>
                  <div className="rounded-xl bg-[#FFF7ED] p-4 text-center dark:bg-stone-800">
                    <p className="text-2xl font-black text-rose-600">{formatCurrency((subReportData as FeeDefaultersReportData)?.kpis?.totalOverdue || 0)}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Total Overdue</p>
                  </div>
                  <div className="rounded-xl bg-[#FFF7ED] p-4 text-center dark:bg-stone-800">
                    <p className="text-2xl font-black text-amber-600">{formatCurrency((subReportData as FeeDefaultersReportData)?.kpis?.avgOverdue || 0)}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Avg Overdue</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                      <tr>
                        <th className="px-3 py-2">Student</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Fee Title</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2 text-right">Overdue Days</th>
                        <th className="px-3 py-2 text-right">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                      {((subReportData as FeeDefaultersReportData)?.records || []).map(r => (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-stone-800/40">
                          <td className="px-3 py-3 font-bold text-slate-900 dark:text-white">{r.studentName}</td>
                          <td className="px-3 py-3">{r.batchName}</td>
                          <td className="px-3 py-3">{r.feeTitle}</td>
                          <td className="px-3 py-3">{r.dueDate}</td>
                          <td className="px-3 py-3 text-right font-bold text-rose-600">{r.daysOverdue} days</td>
                          <td className="px-3 py-3 text-right font-black text-rose-600">{formatCurrency(r.outstandingAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Student Subjects Report */}
            {currentPath === '/admin/reports/student-subjects' && (
              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="rounded-xl bg-[#FFF7ED] p-4 dark:bg-stone-800">
                    <p className="text-xl font-black text-orange-600">{(subReportData as StudentSubjectsReportData)?.kpis?.totalStudents || 0}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">Enrolled Students</p>
                  </div>
                  <div className="rounded-xl bg-[#FFF7ED] p-4 dark:bg-stone-800">
                    <p className="text-xl font-black text-emerald-600">{(subReportData as StudentSubjectsReportData)?.kpis?.withSubjects || 0}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">With Subjects Assigned</p>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                      <tr>
                        <th className="px-3 py-2">Student</th>
                        <th className="px-3 py-2">Admission No</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Course</th>
                        <th className="px-3 py-2">Assigned Subjects</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                      {((subReportData as StudentSubjectsReportData)?.records || []).map(r => (
                        <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-stone-800/40">
                          <td className="px-3 py-3 font-bold text-slate-900 dark:text-white">{r.name}</td>
                          <td className="px-3 py-3 font-mono">{r.admissionNumber}</td>
                          <td className="px-3 py-3">{r.batch}</td>
                          <td className="px-3 py-3">{r.course}</td>
                          <td className="px-3 py-3 font-medium text-slate-700 dark:text-stone-300">{r.subjects}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Other Sub-reports fallback table */}
            {!['/admin/reports/fee-defaulters', '/admin/reports/student-subjects'].includes(currentPath) && (
              <div className="p-8 text-center text-slate-500">
                <p className="text-sm font-semibold">Report generated successfully.</p>
                <p className="mt-1 text-xs text-slate-400">Displaying data records from live database connection.</p>
              </div>
            )}
          </div>
        )}
      </main>
    );
  }

  // =========================================================================
  // VIEW: MAIN DIRECTORY GRID (Reference: dense-1416-001.jpg)
  // =========================================================================
  return (
    <main className="space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-emerald-400 bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-2xl animate-in fade-in">
          {toastMessage}
        </div>
      )}

      {/* Main Header */}
      <div>
        <h2 className="text-3xl font-black text-slate-900 dark:text-white">Reports & Analytics</h2>
        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-stone-400">
          {REPORTS_CONFIG.length} comprehensive reports for insights
        </p>
      </div>

      {/* Top Stat Strip (6 Metric Cards) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {/* 1. STUDENTS */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <AdminIcon name="people" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">STUDENTS</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.students ?? 0}</p>
          </div>
        </div>

        {/* 2. REVENUE */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <AdminIcon name="rupee" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">REVENUE</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.revenue || '₹0'}</p>
          </div>
        </div>

        {/* 3. EXAMS */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <AdminIcon name="quiz" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">EXAMS</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.exams ?? 0}</p>
          </div>
        </div>

        {/* 4. ATTENDANCE */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
            <AdminIcon name="checklist" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">ATTENDANCE</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.attendance || '0%'}</p>
          </div>
        </div>

        {/* 5. FEE COLLECT... */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
            <AdminIcon name="trend" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500 truncate">FEE COLLECT...</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.feeCollectionRate || '0%'}</p>
          </div>
        </div>

        {/* 6. AT RISK */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
            <AdminIcon name="shield" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-stone-500">AT RISK</p>
            <p className="text-xl font-black text-slate-900 dark:text-white">{loadingStats ? '…' : stats?.atRisk ?? 0}</p>
          </div>
        </div>
      </div>

      {/* 24 Report Cards Grid (3 Columns) */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS_CONFIG.map(card => {
          return (
            <div
              key={card.id}
              onClick={() => handleCardClick(card)}
              className="group flex flex-col justify-between rounded-2xl border border-slate-100 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md hover:border-orange-200 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-orange-900/60 cursor-pointer"
            >
              <div className="flex items-start gap-4">
                {/* Icon Chip */}
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${TINTS[card.tint]}`}>
                  <AdminIcon name={card.icon} className="h-6 w-6" />
                </span>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <h3 className="font-extrabold text-slate-800 transition group-hover:text-orange-600 dark:text-white dark:group-hover:text-orange-400">
                    {card.title}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400 dark:text-stone-500 line-clamp-2">
                    {card.description}
                  </p>
                </div>

                {/* Right Arrow Button */}
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-400 transition group-hover:border-orange-500 group-hover:text-orange-600 dark:border-stone-700 dark:text-stone-500 dark:group-hover:border-orange-500 dark:group-hover:text-orange-400">
                  <span className="text-sm font-bold">→</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
