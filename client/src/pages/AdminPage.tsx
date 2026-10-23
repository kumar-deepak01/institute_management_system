import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import AdminSidebar from '../components/AdminSidebar';
import { apiRequest, ApiRequestError } from '../services/api';
import { currentAccount, logout } from '../services/auth';
const AdminStaffPage = lazy(() => import('./AdminStaffPage'));
const AdminStaffAttendancePage = lazy(() => import('./AdminStaffAttendancePage'));
const AdminStudentsPage = lazy(() => import('./AdminStudentsPage'));
const AdminAdmissionsPage = lazy(() => import('./AdminAdmissionsPage'));
const AdminCurriculumPage = lazy(() => import('./AdminCurriculumPage'));
const AdminBatchesPage = lazy(() => import('./AdminBatchesPage'));
const AdminAcademicsPartBPage = lazy(() => import('./AdminAcademicsPartBPage'));
const AdminAcademicsPartAPage = lazy(() => import('./AdminAcademicsPartAPage'));
const AdminDoubtsPage = lazy(() => import('./AdminDoubtsPage'));
const AdminContentMediaPage = lazy(() => import('./AdminContentMediaPage'));
const AdminIntegrationsPage = lazy(() => import('./AdminIntegrationsPage'));
const AdminPtmPage = lazy(() => import('./AdminPtmPage'));
const AdminFinancePage = lazy(() => import('./AdminFinancePage'));
const AdminPayrollPage = lazy(() => import('./AdminPayrollPage'));
const AdminWorkShiftsPage = lazy(() => import('./AdminWorkShiftsPage'));
const AdminFacultyPerformancePage = lazy(() => import('./AdminFacultyPerformancePage'));

type Dashboard = {
  plan: string;
  setup: { completed: number; total: number; steps: { label: string; description: string; complete: boolean }[] };
  stats: { students: number; activeStudents: number; attendancePresent: number; attendanceTotal: number; attendanceRate: number | null; feesCollected: number; paymentsThisMonth: number; pendingAdmissions: number; staff: number; feePending: number; atRisk: number };
  enrollment: { label: string; year: number; quarter: number; count: number }[];
  feeCollection: { label: string; amount: number }[];
  demographics: { gender: { label: string; count: number }[]; states: { label: string; count: number }[]; cities: { label: string; count: number }[] };
  recentTransactions: { id: string; student: string; description: string; amount: number; date: string | null; method: string; receipt: string | null }[];
  recentAdmissions: { id: string; name: string; batch: string; status: string; date: string | null }[];
  studentBirthdays: { id: string; name: string; birthday: string }[];
  staffBirthdays: { id: string; name: string; birthday: string }[];
  atRiskStudents: { id: string; name: string; batch: string; attendance: number }[];
  activeHomework: { id: string; title: string; batch: string; due: string | null; status: string }[];
  todayAttendance: { total: number; present: number };
  upcomingExams: { id: string; name: string; date: string }[];
  todayClasses: { id: string; name: string; time: string }[];
  topPerformers: { id: string; name: string; batch: string; score: number }[];
  peakMonths: string[];
  forecast: number[];
};

type AdminNavItem = { label: string; path: string; icon: string; nested?: boolean };
const groups: { name: string; items: AdminNavItem[] }[] = [
  { name: 'Overview', items: [
    { label: 'Dashboard', path: '/admin', icon: 'dashboard' },
    { label: 'Academic Years', path: '/admin/academic-years', icon: 'calendar' },
    { label: 'Reports', path: '/admin/reports', icon: 'chart' },
  ] },
  { name: 'People', items: [
    { label: 'Students', path: '/admin/students', icon: 'student' },
    { label: 'Staff', path: '/admin/staff', icon: 'staff' },
    { label: 'Online Admissions', path: '/admin/online-admissions', icon: 'addPerson' },
  ] },
  { name: 'Curriculum', items: [
    { label: 'Courses', path: '/admin/courses', icon: 'school' },
    { label: 'Subjects', path: '/admin/subjects', icon: 'book', nested: true },
    { label: 'Topics', path: '/admin/topics', icon: 'tag', nested: true },
    { label: 'Batches', path: '/admin/batches', icon: 'briefcase' },
    { label: 'Question Bank', path: '/admin/question-bank', icon: 'inbox' },
  ] },
  { name: 'Academics', items: [
    { label: 'Timetable', path: '/admin/timetable', icon: 'event' },
    { label: 'Attendance', path: '/admin/attendance', icon: 'checklist' },
    { label: 'Homework', path: '/admin/homework', icon: 'pencil' },
    { label: 'Doubts', path: '/admin/doubts', icon: 'chat' },
    { label: 'Leave & Holidays', path: '/admin/leave-holidays', icon: 'eventOff' },
  ] },
  { name: 'Exams & Results', items: [
    { label: 'Online Exams', path: '/admin/online-exams', icon: 'quiz' },
    { label: 'Offline Exams', path: '/admin/offline-exams', icon: 'edit' },
    { label: 'Test Series', path: '/admin/test-series', icon: 'briefcase' },
    { label: 'Report Cards', path: '/admin/report-cards', icon: 'report' },
    { label: 'Certificates', path: '/admin/certificates', icon: 'verified' },
    { label: 'ID Cards', path: '/admin/id-cards', icon: 'student' },
    { label: 'Proctoring', path: '/admin/proctoring', icon: 'video' },
  ] },
  { name: 'Content & Media', items: [
    { label: 'Download Center', path: '/admin/download-center', icon: 'download' },
    { label: 'Video Lectures', path: '/admin/video-lectures', icon: 'video' },
    { label: 'Live Classes', path: '/admin/live-classes', icon: 'live' },
  ] },
  { name: 'Finance', items: [
    { label: 'Fee Collection', path: '/admin/fees', icon: 'payment' },
    { label: 'Fee Structures', path: '/admin/fee-structures', icon: 'grid', nested: true },
    { label: 'Discounts & Coupons', path: '/admin/discounts', icon: 'tag', nested: true },
    { label: 'Late Fee Rules', path: '/admin/late-fees', icon: 'clock', nested: true },
    { label: 'Payment Reminders', path: '/admin/payment-reminders', icon: 'bell', nested: true },
    { label: 'Deletion Audit Log', path: '/admin/deletion-audit', icon: 'shield', nested: true },
    { label: 'Accounting Export', path: '/admin/accounting-export', icon: 'export', nested: true },
    { label: 'Expenses', path: '/admin/expenses', icon: 'calculator' },
    { label: 'Expense Heads', path: '/admin/expense-heads', icon: 'tag', nested: true },
    { label: 'Income', path: '/admin/income', icon: 'trend' },
    { label: 'Income Heads', path: '/admin/income-heads', icon: 'tag', nested: true },
  ] },
  { name: 'HR & Staff', items: [
    { label: 'Payroll', path: '/admin/payroll', icon: 'payment' },
    { label: 'Staff Attendance', path: '/admin/staff-attendance', icon: 'staffCheck' },
    { label: 'Biometric', path: '/admin/biometric', icon: 'fingerprint' },
    { label: 'Work Shifts', path: '/admin/work-shifts', icon: 'clock', nested: true },
    { label: 'Faculty Performance', path: '/admin/faculty-performance', icon: 'chart' },
  ] },
  { name: 'CRM & Growth', items: [
    { label: 'Lead CRM', path: '/admin/leads', icon: 'filter' },
    { label: 'Lead Nurturing', path: '/admin/lead-nurturing', icon: 'bot', nested: true },
    { label: 'Proposals', path: '/admin/proposals', icon: 'document', nested: true },
    { label: 'Meta Lead Ads', path: '/admin/meta-lead-ads', icon: 'social', nested: true },
    { label: 'Refer & Earn', path: '/admin/referrals', icon: 'gift' },
    { label: 'Alumni Wall', path: '/admin/alumni', icon: 'school' },
  ] },
  { name: 'Communication', items: [
    { label: 'Bulk Messaging', path: '/admin/broadcast', icon: 'megaphone' },
    { label: 'Inbox', path: '/admin/inbox', icon: 'chat', nested: true },
    { label: 'SMS / WhatsApp Hub', path: '/admin/messaging', icon: 'bolt', nested: true },
    { label: 'Email Campaigns', path: '/admin/email-campaigns', icon: 'mail', nested: true },
    { label: 'Custom Forms', path: '/admin/forms', icon: 'form', nested: true },
    { label: 'Custom Columns', path: '/admin/custom-columns', icon: 'columns', nested: true },
    { label: 'PTM Meetings', path: '/admin/ptm', icon: 'people', nested: true },
  ] },
  { name: 'Operations', items: [
    { label: 'Library', path: '/admin/library', icon: 'book' },
    { label: 'Library Fines', path: '/admin/library-fines', icon: 'rupee', nested: true },
    { label: 'Transport', path: '/admin/transport', icon: 'truck' },
    { label: 'Hostel', path: '/admin/hostel', icon: 'home' },
    { label: 'Inventory', path: '/admin/inventory', icon: 'boxes' },
    { label: 'Canteen', path: '/admin/canteen', icon: 'coffee' },
    { label: 'Gamification', path: '/admin/gamification', icon: 'trophy' },
  ] },
  { name: 'Settings', items: [
    { label: 'General Settings', path: '/admin/settings', icon: 'settings' },
    { label: 'Branches', path: '/admin/branches', icon: 'building' },
    { label: 'Roles & Permissions', path: '/admin/roles', icon: 'shield' },
    { label: 'Mobile App Branding', path: '/admin/mobile-branding', icon: 'mobile' },
    { label: 'Integrations', path: '/admin/integrations', icon: 'puzzle' },
    { label: 'AI Credits', path: '/admin/ai-credits', icon: 'chip' },
  ] },
];
const quickActions = [
  ['Add Student', '/admin/students', '＋'], ['New Exam', '/admin/online-exams', '▤'], ['Attendance', '/admin/attendance', '◷'], ['Fees', '/admin/fees', '₹'],
  ['Broadcast', '/admin/broadcast', '◉'], ['Homework', '/admin/homework', '▣'], ['Lead CRM', '/admin/leads', '⌕'], ['Reports', '/admin/reports', '▥'],
];
const number = (value: number) => new Intl.NumberFormat('en-IN').format(value);
const money = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export default function AdminPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const dashboardRef = useRef<Dashboard | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    currentAccount().then(({ account }) => {
      if (!active) return;
      if (account.role !== 'admin') {
        setError('Administrator access is required for this page.');
        setLoading(false);
        return;
      }
      setSessionReady(true);
    }).catch(cause => {
      if (!active) return;
      if (cause instanceof ApiRequestError && cause.status === 401) {
        navigate('/login', { replace: true });
        return;
      }
      setError(cause instanceof Error ? cause.message : 'Could not check the current session.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [navigate]);

  const loadDashboard = useCallback(async () => {
    if (!dashboardRef.current) setLoading(true);
    setError('');
    try {
      const data = await apiRequest<Dashboard>('/api/admin/dashboard');
      dashboardRef.current = data;
      setDashboard(data);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 401) {
        dashboardRef.current = null;
        setDashboard(null);
        navigate('/login', { replace: true });
        return;
      }
      if (!dashboardRef.current) setError(cause instanceof Error ? cause.message : 'Dashboard could not be loaded.');
    } finally { setLoading(false); }
  }, [navigate]);

  useEffect(() => {
    const activePath = location.pathname === '/admin.html' ? '/admin' : location.pathname.replace(/\/$/, '') || '/admin';
    if (sessionReady && activePath === '/admin') void loadDashboard();
  }, [location.pathname, loadDashboard, sessionReady]);

  const currentPath = location.pathname === '/admin.html' ? '/admin' : location.pathname.replace(/\/$/, '') || '/admin';
  const activeItem = groups.flatMap(group => group.items).find(item => item.path === currentPath || (item.path === '/admin/students' && currentPath.startsWith('/admin/students/')) || (item.path === '/admin/staff' && currentPath.startsWith('/admin/staff/')));
  const pageTitle = activeItem?.label || 'Dashboard';
  const searchMatches = useMemo(() => globalSearch.trim() ? groups.flatMap(group => group.items).filter(item => item.label.toLowerCase().includes(globalSearch.toLowerCase())).slice(0, 6) : [], [globalSearch]);

  async function signOut() {
    try { await logout(); } finally { navigate('/login', { replace: true }); }
  }
  function openPage(path: string) { navigate(path); setSidebarOpen(false); setGlobalSearch(''); }
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const navigateSidebar = useCallback(() => { setSidebarOpen(false); setGlobalSearch(''); }, []);

  return <div className="min-h-screen bg-[#f4f7fb] text-slate-800">
    <AdminSidebar groups={groups} currentPath={currentPath} sidebarOpen={sidebarOpen} onClose={closeSidebar} onNavigate={navigateSidebar} />
    {sidebarOpen && <button aria-label="Close menu overlay" onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" />}

    <div className="min-h-screen lg:pl-[335px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-7">
        <button onClick={() => setSidebarOpen(true)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 lg:hidden" aria-label="Open navigation"><AdminIcon name="menu" className="h-5 w-5"/></button>
        <div className="min-w-0 flex-1"><p className="text-[11px] font-bold text-slate-400">My JEE Mentor / Admin</p><h1 className="truncate text-lg font-extrabold">{pageTitle}</h1></div>
        <span className="hidden rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 sm:inline-flex">{dashboard?.plan || 'Plan status'}</span>
        <div className="relative hidden w-56 md:block xl:w-72"><span className="absolute left-3 top-2.5 text-slate-400"><AdminIcon name="search" className="h-4 w-4"/></span><input aria-label="Global search" value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} placeholder="Search pages..." className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" />{searchMatches.length > 0 && <div className="absolute left-0 right-0 top-12 rounded-xl border bg-white p-1 shadow-xl">{searchMatches.map(item => <button key={item.path} onClick={() => openPage(item.path)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">{item.label}</button>)}</div>}</div>
        <div className="relative"><button onClick={() => setNotificationsOpen(value => !value)} aria-label="Notifications" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-lg text-slate-600"><AdminIcon name="bell" className="h-5 w-5"/></button>{notificationsOpen && <div className="absolute right-0 top-12 w-64 rounded-xl border bg-white p-4 text-sm shadow-xl"><b>Notifications</b><p className="mt-2 text-slate-500">No new notifications.</p></div>}</div>
        <button onClick={() => openPage('/admin/settings')} aria-label="Settings" className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-lg text-slate-600 sm:grid"><AdminIcon name="settings" className="h-5 w-5"/></button>
        <button onClick={() => void signOut()} className="rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white sm:px-4 sm:text-sm">Log out</button>
      </header>

      <main className="mx-auto max-w-[1500px] p-4 sm:p-6 xl:p-8">
        {currentPath === '/admin/ptm' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading parent meetings...</div>}><AdminPtmPage /></Suspense> : currentPath === '/admin/integrations' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading integrations…</div>}><AdminIntegrationsPage /></Suspense> : currentPath === '/admin/batches' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading batches</div>}><AdminBatchesPage /></Suspense> : currentPath === '/admin/work-shifts' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading work shifts</div>}><AdminWorkShiftsPage /></Suspense> : currentPath === '/admin/faculty-performance' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading faculty performance</div>}><AdminFacultyPerformancePage /></Suspense> : currentPath.startsWith('/admin/finance') || ['/admin/fees','/admin/fee-structures','/admin/discounts','/admin/late-fees','/admin/payment-reminders','/admin/deletion-audit','/admin/accounting-export','/admin/expenses','/admin/expense-heads','/admin/income','/admin/income-heads'].includes(currentPath) || currentPath === '/admin/fees/report' || currentPath.startsWith('/admin/expenses/') || currentPath.startsWith('/admin/income/') ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading Finance workspace…</div>}><AdminFinancePage key={currentPath} /></Suspense> : currentPath.startsWith('/admin/payroll') ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading payroll workspace…</div>}><AdminPayrollPage key={currentPath} /></Suspense> : currentPath === '/admin/staff-attendance' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading staff attendance…</div>}><AdminStaffAttendancePage /></Suspense> : currentPath.startsWith('/admin/staff') ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading staff workspace…</div>}><AdminStaffPage /></Suspense> : currentPath.startsWith('/admin/students') ? <Suspense fallback={<div role="status" className="p-12 text-center text-slate-500">Loading student workspace…</div>}><AdminStudentsPage /></Suspense> : currentPath === '/admin/online-admissions' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading admissions workspace…</div>}><AdminAdmissionsPage /></Suspense> : ['/admin/academic-years','/admin/courses','/admin/subjects','/admin/topics','/admin/batches'].includes(currentPath) ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading curriculum workspace…</div>}><AdminCurriculumPage key={currentPath} /></Suspense> : currentPath === '/admin/homework' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading homework workspace…</div>}><AdminAcademicsPartBPage key={currentPath} /></Suspense> : currentPath === '/admin/doubts' ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading doubts workspace…</div>}><AdminDoubtsPage /></Suspense> : ['/admin/attendance','/admin/timetable','/admin/leave-holidays'].includes(currentPath) ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading academics workspace…</div>}><AdminAcademicsPartAPage key={currentPath} /></Suspense> : ['/admin/download-center','/admin/video-lectures','/admin/live-classes'].includes(currentPath) ? <Suspense fallback={<div role="status" className="grid min-h-[55vh] place-items-center text-slate-500">Loading content workspace…</div>}><AdminContentMediaPage key={currentPath} /></Suspense> : currentPath !== '/admin' ? <section className="grid min-h-[60vh] place-items-center"><div className="max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><AdminIcon name="star" className="h-6 w-6"/></span><h2 className="mt-5 text-2xl font-black">{pageTitle}</h2><p className="mt-2 text-sm leading-6 text-slate-500">This area is coming soon. Your existing institute records remain available as these pages are built.</p><button onClick={() => navigate('/admin')} className="mt-6 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white">Back to dashboard</button></div></section> : loading ? <div role="status" className="grid min-h-[55vh] place-items-center"><div className="text-center"><span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600"/><p className="mt-4 text-sm font-semibold text-slate-500">Loading dashboard data…</p></div></div> : error ? <div role="alert" className="rounded-2xl border border-rose-200 bg-white p-8"><h2 className="text-lg font-extrabold text-rose-800">Dashboard data could not be loaded</h2><p className="mt-2 text-sm text-slate-600">{error}</p><button onClick={() => void loadDashboard()} className="mt-5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">Try again</button></div> : dashboard && <DashboardView data={dashboard} onAction={openPage} />}
      </main>
    </div>
  </div>;
}

function DashboardView({ data, onAction }: { data: Dashboard; onAction: (path: string) => void }) {
  const [period, setPeriod] = useState<'Monthly' | 'Quarterly' | 'Yearly'>('Monthly');
  const [demographic, setDemographic] = useState<'Gender' | 'States' | 'Cities'>('Gender');
  const setupPercent = data.setup.total ? Math.round(data.setup.completed * 100 / data.setup.total) : 0;
  const nextStep = data.setup.steps.find(step => !step.complete);
  const colors = ['#2864ed', '#11b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  const demographicData = demographic === 'Gender' ? data.demographics.gender : demographic === 'States' ? data.demographics.states : data.demographics.cities;
  const demoTotal = demographicData.reduce((sum, item) => sum + item.count, 0);
  const demoStops = demographicData.reduce<{ css: string; value: number }>((acc, item, index) => {
    const next = acc.value + (demoTotal ? item.count * 100 / demoTotal : 0);
    acc.css += `${colors[index % colors.length]} ${acc.value}% ${next}%,`;
    acc.value = next;
    return acc;
  }, { css: '', value: 0 }).css.replace(/,$/, '');
  const dashboardStats = [
    { title: 'Students', value: number(data.stats.students), note: `${number(data.stats.activeStudents)} active students`, color: 'blue', icon: 'student', path: '/admin/students' },
    { title: 'Revenue (month)', value: money(data.stats.feesCollected), note: `${money(data.stats.feePending)} pending`, color: 'green', icon: 'payment', path: '/admin/fees' },
    { title: 'At-risk students', value: number(data.stats.atRisk), note: 'Based on attendance over 30 days', color: 'red', icon: 'warning', path: '/admin/reports' },
    { title: 'Fee collection', value: `${data.stats.feePending + data.stats.feesCollected > 0 ? Math.round(data.stats.feesCollected * 100 / (data.stats.feePending + data.stats.feesCollected)) : 0}%`, note: `${number(data.stats.paymentsThisMonth)} payments this month`, color: 'cyan', icon: 'chart', path: '/admin/fees' },
  ];
  const quickIcons: Record<string, string> = { 'Add Student': 'addPerson', 'New Exam': 'quiz', Attendance: 'checklist', Fees: 'payment', Broadcast: 'megaphone', Homework: 'pencil', 'Lead CRM': 'funnel', Reports: 'chart' };
  const quickPaths: Record<string, string> = { 'Add Student': '/admin/students', 'New Exam': '/admin/online-exams', Attendance: '/admin/attendance', Fees: '/admin/fees', Broadcast: '/admin/bulk-messaging', Homework: '/admin/homework', 'Lead CRM': '/admin/lead-crm', Reports: '/admin/reports' };
  const panel = (title: string, icon: string, children: React.ReactNode, action?: [string, string], className = '') => <section className={`overflow-hidden rounded-2xl border border-[#bfd0ff] bg-white shadow-sm ${className}`}><header className="flex min-h-[54px] items-center justify-between gap-3 border-b border-[#c8d5f5] bg-gradient-to-r from-[#e0e9ff] to-[#f4f7ff] px-4 py-3"><h2 className="flex items-center gap-2 font-extrabold text-blue-800"><AdminIcon name={icon} className="h-5 w-5 text-blue-600"/>{title}</h2>{action && <button onClick={() => onAction(action[1])} className="text-xs font-bold text-blue-600 hover:underline">{action[0]} →</button>}</header>{children}</section>;
  const listEmpty = (message: string) => <div className="grid min-h-36 place-content-center px-4 text-center text-sm text-slate-400"><span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-slate-50 text-slate-300"><AdminIcon name="inbox" className="h-6 w-6"/></span>{message}</div>;
  const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const chartData = period === 'Monthly' ? data.enrollment : period === 'Quarterly' ? Object.values(data.enrollment.reduce<Record<string,{label:string;count:number}>>((all,item) => { const key=`${item.year}-Q${item.quarter}`; all[key] ??= { label:`Q${item.quarter} ${item.year}`, count:0 }; all[key].count+=item.count; return all; },{})) : Object.values(data.enrollment.reduce<Record<string,{label:string;count:number}>>((all,item) => { const key=String(item.year); all[key] ??= { label:key, count:0 }; all[key].count+=item.count; return all; },{}));
  const chartValues = chartData.map(item => item.count);
  const chartLabels = chartData.map(item => item.label);
  const collectedRate = data.stats.feePending + data.stats.feesCollected > 0 ? Math.round(data.stats.feesCollected * 100 / (data.stats.feePending + data.stats.feesCollected)) : 0;
  return <div className="space-y-6">
    <section className="overflow-hidden rounded-[22px] bg-gradient-to-r from-[#2864ed] to-[#0643c7] text-white shadow-lg">
      <div className="flex flex-wrap items-center gap-4 px-6 py-5"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><AdminIcon name="school" className="h-7 w-7 text-white"/></span><div className="min-w-[220px] flex-1"><h2 className="text-lg font-black">Setup Progress — {data.setup.completed}/{data.setup.total} steps complete</h2><p className="mt-1 text-sm text-blue-100">{nextStep ? `Next: ${nextStep.label} · ${nextStep.description}` : 'Your institute setup is complete.'}</p></div><strong className="text-3xl font-black">{setupPercent}%</strong><button onClick={() => nextStep && onAction(setupPath(nextStep.label))} disabled={!nextStep} className="rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-blue-700 disabled:opacity-60">{nextStep ? `Continue: ${nextStep.label}` : 'Setup complete'}</button></div>
      <div className="h-2 bg-blue-950/20"><div className="h-full bg-emerald-300 transition-all" style={{ width: `${setupPercent}%` }}/></div>
      <div className="grid gap-2 px-6 py-3" style={{ gridTemplateColumns: `repeat(${Math.max(1, data.setup.total)}, minmax(0, 1fr))` }}>{data.setup.steps.map(step => <span key={step.label} title={`${step.complete ? 'Complete' : 'Next'}: ${step.label}`} className={`h-1.5 rounded-full ${step.complete ? 'bg-emerald-300' : 'bg-white/20'}`}/>)}</div>
    </section>

    <section className="grid gap-5 2xl:grid-cols-[1.25fr_1fr]">
      <article className="flex min-h-[260px] flex-col justify-center rounded-[22px] bg-gradient-to-br from-[#2864ed] to-[#0643c7] p-7 text-white shadow-lg"><p className="text-xs font-bold uppercase tracking-[.17em] text-blue-100">Institute dashboard</p><h2 className="mt-3 text-3xl font-black">My JEE Mentor</h2><p className="mt-3 text-sm text-blue-100">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><p className="mt-4 text-sm text-blue-100">Live overview from your institute records.</p><div className="mt-6 flex flex-wrap gap-3"><span className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold">{number(data.stats.students)} Students</span><span className="rounded-full bg-emerald-400/20 px-4 py-2 text-sm font-bold text-emerald-100">{money(data.stats.feesCollected)} This Month</span></div></article>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{dashboardStats.map((card) => <button key={card.title} onClick={() => onAction(card.path)} className={`min-h-[122px] rounded-2xl border border-slate-100 bg-gradient-to-br p-5 text-left shadow-sm ${card.color === 'blue' ? 'from-blue-50 to-white' : card.color === 'green' ? 'from-emerald-50 to-white' : card.color === 'red' ? 'from-rose-50 to-white' : 'from-cyan-50 to-white'}`}><span className="flex items-center justify-between"><span className="text-2xl font-black text-slate-800">{card.value}</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-white/70"><AdminIcon name={card.icon} className={`h-6 w-6 ${card.color === 'green' ? 'text-emerald-500' : card.color === 'red' ? 'text-rose-500' : card.color === 'cyan' ? 'text-cyan-500' : 'text-blue-600'}`}/></span></span><span className="mt-2 block text-[11px] font-black uppercase tracking-wider text-slate-500">{card.title}</span><span className="mt-1 block text-xs font-semibold text-slate-500">{card.note}</span></button>)}</div>
    </section>

    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 2xl:grid-cols-8">{quickActions.map(([label]) => <button key={label} onClick={() => onAction(quickPaths[label])} className="group flex min-h-[104px] flex-col items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"><AdminIcon name={quickIcons[label]} className="h-9 w-9 text-blue-600 group-hover:text-blue-700"/><span className="text-sm font-bold text-slate-800">{label}</span></button>)}</section>

    <section className="grid gap-5 2xl:grid-cols-[1.45fr_.75fr]">
      {panel('Student Enrollment Trend', 'pulse', <div className="p-4"><div className="mb-3 flex justify-end gap-1">{(['Monthly','Quarterly','Yearly'] as const).map(item => <button key={item} onClick={() => setPeriod(item)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${period === item ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>{item}</button>)}</div>{chartData.some(item => item.count > 0) ? <TrendChart values={chartValues} labels={chartLabels}/> : <EmptyChart message="No enrollment records yet" detail="Saved student enrollments will appear here."/>}</div>)}
      {panel('Demographics', 'chart', <div className="p-4"><div className="mb-4 flex justify-end gap-2">{(['Gender','States','Cities'] as const).map(item => <button key={item} onClick={() => setDemographic(item)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${demographic === item ? 'bg-white text-blue-700 shadow' : 'text-slate-500'}`}>{item}</button>)}</div>{demographicData.length ? <div className="flex min-h-[225px] items-center justify-center gap-7"><div aria-label={`Student demographics by ${demographic.toLowerCase()}`} role="img" style={{ background: `conic-gradient(${demoStops || '#e2e8f0 0% 100%'})` }} className="grid h-40 w-40 shrink-0 place-items-center rounded-full"><span className="h-24 w-24 rounded-full bg-white"/></div><div className="grid gap-3">{demographicData.map((item, index) => <p key={item.label} className="flex items-center gap-2 text-sm font-semibold capitalize"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colors[index % colors.length] }}/>{item.label}<b className="ml-auto pl-4">{item.count}</b></p>)}</div></div> : listEmpty(`No ${demographic.toLowerCase()} data saved on student records yet`)}</div>)}
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      {panel('Recent Transactions', 'payment', data.recentTransactions.length ? <div className="divide-y px-4">{data.recentTransactions.map(item => <div key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-600"><AdminIcon name="payment" className="h-5 w-5"/></span><div className="min-w-0 flex-1"><b className="block truncate text-sm">{item.student}</b><p className="truncate text-xs text-slate-500">{item.description}{item.method && <> · {item.method}</>}</p></div><div className="text-right"><b className="block text-sm text-emerald-600">+{money(item.amount)}</b><span className="text-xs text-slate-400">{dateLabel(item.date)}</span></div></div>)}</div> : listEmpty('No transactions recorded yet'), ['View ledger', '/admin/fees'])}
      {panel('Recent Inquiries & CRM Leads', 'funnel', data.recentAdmissions.length ? <div className="divide-y px-4">{data.recentAdmissions.map(item => <div key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-violet-50 text-violet-700"><AdminIcon name="addPerson" className="h-5 w-5"/></span><div className="min-w-0 flex-1"><b className="block truncate text-sm">{item.name}</b><p className="truncate text-xs text-slate-500">{item.batch || 'Admission inquiry'} · {item.status}</p></div><span className="text-xs text-slate-400">{dateLabel(item.date)}</span></div>)}</div> : listEmpty('No leads or inquiries yet'), ['Go to CRM', '/admin/lead-crm'])}
    </section>

    <section className="rounded-2xl bg-[#2864ed] p-5 text-white shadow-sm sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black">Predictive Insights</h2><p className="mt-1 text-xs text-blue-100">Enrollment estimate from recent saved enrollment history</p></div><button onClick={() => onAction('/admin/reports')} className="rounded-lg border border-white/25 px-3 py-2 text-xs font-bold">↻ Refresh</button></div><div className="mt-5 grid gap-3 sm:grid-cols-3">{data.forecast.map((count, index) => <div key={index} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center"><b className="text-3xl">{number(count)}</b><p className="mt-1 text-xs font-bold uppercase text-blue-100">{new Date(new Date().getFullYear(), new Date().getMonth() + index + 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p></div>)}</div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center"><p className="text-[11px] font-bold uppercase text-blue-100">Peak months</p><b className="mt-2 block text-sm">{data.peakMonths.length ? data.peakMonths.join(', ') : 'Not enough history'}</b></div><div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center"><p className="text-[11px] font-bold uppercase text-blue-100">Attendance risk</p><b className="mt-2 block text-2xl">{data.stats.students ? `${Math.round(data.stats.atRisk * 100 / data.stats.students)}%` : '—'}</b></div><div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center"><p className="text-[11px] font-bold uppercase text-blue-100">Enrollment trend</p><b className="mt-2 block text-sm">{chartValues.length > 1 && chartValues[chartValues.length - 1] > chartValues[0] ? '↑ Growing' : chartValues.length > 1 && chartValues[chartValues.length - 1] < chartValues[0] ? '↓ Declining' : '→ Stable'}</b></div></div></section>

    <section className="grid gap-5 2xl:grid-cols-[1.45fr_.75fr]">
      {panel('Revenue — Last 6 Months', 'chart', <div className="p-4"><div className="mb-2 flex justify-between text-xs text-slate-500"><span>{collectedRate}% collected against recorded fees</span><span>{money(data.stats.feePending)} pending</span></div>{data.feeCollection.some(item => item.amount > 0) ? <BarChart values={data.feeCollection.map(item => item.amount)} labels={data.feeCollection.map(item => item.label)}/> : <EmptyChart message="No fee collection records yet" detail="Recorded payments will appear here."/>}</div>, ['Open fee collection', '/admin/fees'])}
      {panel("Today's Classes", 'event', <><div className="border-b bg-slate-50 px-4 py-3"><div className="flex justify-between text-xs font-bold uppercase text-slate-500"><span>Today's attendance split</span><span>{data.todayAttendance.total ? `${data.todayAttendance.present}/${data.todayAttendance.total} present` : 'Unmarked'}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${data.todayAttendance.total ? data.todayAttendance.present * 100 / data.todayAttendance.total : 0}%` }}/></div><div className="mt-2 flex justify-between text-xs"><span className="text-slate-400">{data.todayAttendance.total ? 'Attendance saved today' : 'No student records submitted today'}</span><button onClick={() => onAction('/admin/attendance')} className="font-bold text-blue-600">Mark now →</button></div></div>{data.todayClasses.length ? <div className="divide-y px-4">{data.todayClasses.map(item => <p key={item.id} className="flex justify-between py-3 text-sm"><b>{item.name}</b><span className="text-slate-500">{item.time}</span></p>)}</div> : listEmpty('No classes today')}</>, ['Timetable', '/admin/timetable'])}
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      {panel("Today's Student Birthdays", 'birthday', data.studentBirthdays.length ? <div className="divide-y px-4">{data.studentBirthdays.map(item => <p key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-pink-50 text-pink-600">{item.name.slice(0,1).toUpperCase()}</span><b className="text-sm">{item.name}</b></p>)}</div> : listEmpty('No student birthdays today'))}
      {panel("Today's Staff Birthdays", 'birthday', data.staffBirthdays.length ? <div className="divide-y px-4">{data.staffBirthdays.map(item => <p key={item.id} className="flex items-center gap-3 py-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-blue-50 text-blue-600">{item.name.slice(0,1).toUpperCase()}</span><b className="text-sm">{item.name}</b></p>)}</div> : listEmpty('No staff birthdays today'))}
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      {panel('Upcoming Exams', 'quiz', data.upcomingExams.length ? <div className="divide-y px-4">{data.upcomingExams.map(item => <p key={item.id} className="flex justify-between py-3 text-sm"><b>{item.name}</b><span className="text-slate-500">{dateLabel(item.date)}</span></p>)}</div> : listEmpty('No upcoming exams'))}
      {panel('At-Risk Students', 'warning', data.atRiskStudents.length ? <div className="divide-y px-4">{data.atRiskStudents.map(item => <div key={item.id} className="py-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><b className="block truncate text-sm">{item.name}</b><span className="text-xs uppercase text-slate-400">{item.batch || 'No batch assigned'}</span></div><b className="text-sm text-rose-600">{item.attendance}%</b></div><div className="mt-2 h-1.5 rounded-full bg-rose-100"><div className="h-full rounded-full bg-rose-500" style={{ width: `${item.attendance}%` }}/></div></div>)}</div> : listEmpty('No at-risk students from recent attendance'), ['View all', '/admin/reports'])}
      {panel('Top Performers', 'verified', data.topPerformers.length ? <div className="divide-y px-4">{data.topPerformers.map(item => <p key={item.id} className="flex justify-between py-3 text-sm"><span><b>{item.name}</b><small className="ml-2 text-slate-400">{item.batch}</small></span><b className="text-amber-600">{item.score}%</b></p>)}</div> : listEmpty('No exam results recorded yet'))}
      {panel('Active Homework', 'book', data.activeHomework.length ? <div className="divide-y px-4">{data.activeHomework.map(item => <p key={item.id} className="flex justify-between gap-3 py-3 text-sm"><span><b className="block">{item.title}</b><small className="text-slate-400">{item.batch}</small></span><span className="shrink-0 text-xs text-slate-500">{item.due ? `Due ${dateLabel(item.due)}` : item.status}</span></p>)}</div> : listEmpty('No active homework'), ['View all', '/admin/homework'])}
    </section>
    <footer className="border-t border-slate-200 py-4 text-xs text-slate-500">© {new Date().getFullYear()} My JEE Mentor</footer>
  </div>;
}

function setupPath(label: string) { const value = label.toLowerCase(); return value.includes('academic') ? '/admin/academic-years' : value.includes('course') ? '/admin/courses' : value.includes('batch') ? '/admin/batches' : value.includes('student') ? '/admin/students' : value.includes('staff') ? '/admin/staff' : value.includes('admission') ? '/admin/online-admissions' : value.includes('subject') ? '/admin/subjects' : value.includes('topic') ? '/admin/topics' : value.includes('fee') || value.includes('payment') ? '/admin/fees' : value.includes('broadcast') ? '/admin/bulk-messaging' : value.includes('homework') ? '/admin/homework' : value.includes('payroll') ? '/admin/payroll' : '/admin/settings'; }

function EmptyChart({ message, detail }: { message: string; detail: string }) { return <div className="grid h-[230px] place-content-center text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-400"><AdminIcon name="chart" className="h-5 w-5"/></span><p className="mt-3 text-sm font-bold text-slate-700">{message}</p><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">{detail}</p></div>; }
function TrendChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1); const points = values.map((value, index) => `${36 + index * 64},${174 - value / max * 130}`).join(' ');
  return <div className="pt-4"><svg viewBox="0 0 390 205" className="h-[205px] w-full" role="img" aria-label="Student enrollments by month"><path d="M36 174 H360 M36 112 H360 M36 50 H360" stroke="#e9edf4" strokeWidth="1"/><polyline points={points} fill="none" stroke="#5965d8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{values.map((value, index) => { const x = 36 + index * 64; const y = 174 - value / max * 130; return <g key={`${labels[index]}-${index}`}><circle cx={x} cy={y} r="4" fill="white" stroke="#5965d8" strokeWidth="3"/><text x={x} y="198" textAnchor="middle" fontSize="10" fill="#8993a5">{labels[index]}</text></g>; })}</svg><div className="flex justify-between px-1 text-[11px] text-slate-400"><span>Students enrolled</span><span>{number(values.reduce((sum, value) => sum + value, 0))} total</span></div></div>;
}
function BarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return <div className="flex h-[245px] items-end justify-between gap-2 px-1 pt-5">{values.map((value, index) => <div key={`${labels[index]}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] font-semibold text-slate-500">{value ? money(value) : '—'}</span><div title={`${labels[index]}: ${money(value)}`} style={{ height: `${Math.max(value / max * 145, value ? 8 : 3)}px` }} className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400"/><span className="text-[10px] text-slate-400">{labels[index]}</span></div>)}</div>;
}

