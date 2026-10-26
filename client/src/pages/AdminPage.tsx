import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import AdminIcon from '../components/AdminIcon';
import AdminSidebar from '../components/AdminSidebar';
import DashboardActionIcon from '../components/dashboard/DashboardActionIcon';
import DemographicsDonutChart from '../components/dashboard/DemographicsDonutChart';
import EnrollmentTrendChart from '../components/dashboard/EnrollmentTrendChart';
import StatSparkline from '../components/dashboard/StatSparkline';
import { apiRequest, ApiRequestError } from '../services/api';
import { currentAccount, logout } from '../services/auth';
import { loadDashboardCached } from '../services/dashboardCache';
import { useAppTheme } from '../theme/useAppTheme';
import welcomeIllustration from '../assets/welcome-illustration.webp';

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
const AdminReportsPage = lazy(() => import('./AdminReportsPage'));

type Dashboard = {
  setup: { completed: number; total: number; steps: { label: string; description: string; complete: boolean }[] };
  stats: {
    students: number;
    activeStudents: number;
    attendancePresent: number;
    attendanceTotal: number;
    attendanceRate: number | null;
    feesCollected: number;
    paymentsThisMonth: number;
    pendingAdmissions: number;
    staff: number;
    feePending: number;
    atRisk: number;
  };
  enrollment: { label: string; year: number; quarter: number; count: number }[];
  feeCollection: { label: string; amount: number }[];
  demographics: {
    gender: { label: string; count: number }[];
    states: { label: string; count: number }[];
    cities: { label: string; count: number }[];
  };
  recentTransactions: {
    id: string;
    student: string;
    description: string;
    amount: number;
    date: string | null;
    method: string;
    receipt: string | null;
  }[];
  recentAdmissions: {
    id: string;
    name: string;
    batch: string;
    status: string;
    date: string | null;
  }[];
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
  {
    name: 'Overview',
    items: [
      { label: 'Dashboard', path: '/admin', icon: 'dashboard' },
      { label: 'Academic Years', path: '/admin/academic-years', icon: 'calendar' },
      { label: 'Reports', path: '/admin/reports', icon: 'chart' },
    ],
  },
  {
    name: 'People',
    items: [
      { label: 'Students', path: '/admin/students', icon: 'student' },
      { label: 'Staff', path: '/admin/staff', icon: 'staff' },
      { label: 'Online Admissions', path: '/admin/online-admissions', icon: 'addPerson' },
    ],
  },
  {
    name: 'Curriculum',
    items: [
      { label: 'Courses', path: '/admin/courses', icon: 'school' },
      { label: 'Subjects', path: '/admin/subjects', icon: 'book', nested: true },
      { label: 'Topics', path: '/admin/topics', icon: 'tag', nested: true },
      { label: 'Batches', path: '/admin/batches', icon: 'briefcase' },
      { label: 'Question Bank', path: '/admin/question-bank', icon: 'inbox' },
    ],
  },
  {
    name: 'Academics',
    items: [
      { label: 'Timetable', path: '/admin/timetable', icon: 'event' },
      { label: 'Attendance', path: '/admin/attendance', icon: 'checklist' },
      { label: 'Homework', path: '/admin/homework', icon: 'pencil' },
      { label: 'Doubts', path: '/admin/doubts', icon: 'chat' },
      { label: 'Leave & Holidays', path: '/admin/leave-holidays', icon: 'eventOff' },
    ],
  },
  {
    name: 'Exams & Results',
    items: [
      { label: 'Online Exams', path: '/admin/online-exams', icon: 'quiz' },
      { label: 'Offline Exams', path: '/admin/offline-exams', icon: 'edit' },
      { label: 'Test Series', path: '/admin/test-series', icon: 'briefcase' },
      { label: 'Report Cards', path: '/admin/report-cards', icon: 'report' },
      { label: 'Certificates', path: '/admin/certificates', icon: 'verified' },
      { label: 'ID Cards', path: '/admin/id-cards', icon: 'student' },
      { label: 'Proctoring', path: '/admin/proctoring', icon: 'video' },
    ],
  },
  {
    name: 'Content & Media',
    items: [
      { label: 'Download Center', path: '/admin/download-center', icon: 'download' },
      { label: 'Video Lectures', path: '/admin/video-lectures', icon: 'video' },
      { label: 'Live Classes', path: '/admin/live-classes', icon: 'live' },
    ],
  },
  {
    name: 'Finance',
    items: [
      { label: 'Fee Collection', path: '/admin/fee-structures', icon: 'payment' },
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
    ],
  },
  {
    name: 'HR & Staff',
    items: [
      { label: 'Payroll', path: '/admin/payroll', icon: 'payment' },
      { label: 'Staff Attendance', path: '/admin/staff-attendance', icon: 'staffCheck' },
      { label: 'Biometric', path: '/admin/biometric', icon: 'fingerprint' },
      { label: 'Work Shifts', path: '/admin/work-shifts', icon: 'clock', nested: true },
      { label: 'Faculty Performance', path: '/admin/faculty-performance', icon: 'chart' },
    ],
  },
  {
    name: 'CRM & Growth',
    items: [
      { label: 'Lead CRM', path: '/admin/leads', icon: 'filter' },
      { label: 'Lead Nurturing', path: '/admin/lead-nurturing', icon: 'bot', nested: true },
      { label: 'Proposals', path: '/admin/proposals', icon: 'document', nested: true },
      { label: 'Meta Lead Ads', path: '/admin/meta-lead-ads', icon: 'social', nested: true },
      { label: 'Refer & Earn', path: '/admin/referrals', icon: 'gift' },
      { label: 'Alumni Wall', path: '/admin/alumni', icon: 'school' },
    ],
  },
  {
    name: 'Communication',
    items: [
      { label: 'Bulk Messaging', path: '/admin/broadcast', icon: 'megaphone' },
      { label: 'Inbox', path: '/admin/inbox', icon: 'chat', nested: true },
      { label: 'SMS / WhatsApp Hub', path: '/admin/messaging', icon: 'bolt', nested: true },
      { label: 'Email Campaigns', path: '/admin/email-campaigns', icon: 'mail', nested: true },
      { label: 'Custom Forms', path: '/admin/forms', icon: 'form', nested: true },
      { label: 'Custom Columns', path: '/admin/custom-columns', icon: 'columns', nested: true },
      { label: 'PTM Meetings', path: '/admin/ptm', icon: 'people', nested: true },
    ],
  },
  {
    name: 'Operations',
    items: [
      { label: 'Library', path: '/admin/library', icon: 'book' },
      { label: 'Library Fines', path: '/admin/library-fines', icon: 'rupee', nested: true },
      { label: 'Transport', path: '/admin/transport', icon: 'truck' },
      { label: 'Hostel', path: '/admin/hostel', icon: 'home' },
      { label: 'Inventory', path: '/admin/inventory', icon: 'boxes' },
      { label: 'Canteen', path: '/admin/canteen', icon: 'coffee' },
      { label: 'Gamification', path: '/admin/gamification', icon: 'trophy' },
    ],
  },
  {
    name: 'Settings',
    items: [
      { label: 'General Settings', path: '/admin/settings', icon: 'settings' },
      { label: 'Branches', path: '/admin/branches', icon: 'building' },
      { label: 'Roles & Permissions', path: '/admin/roles', icon: 'shield' },
      { label: 'Mobile App Branding', path: '/admin/mobile-branding', icon: 'mobile' },
      { label: 'Integrations', path: '/admin/integrations', icon: 'puzzle' },
      { label: 'AI Credits', path: '/admin/ai-credits', icon: 'chip' },
    ],
  },
];

const number = (value: number) => new Intl.NumberFormat('en-IN').format(value);
const money = (value: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export default function AdminPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sessionReady, setSessionReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ name: string; role: string }>({ name: 'Deepak', role: 'admin' });
  const dashboardRef = useRef<Dashboard | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { theme, toggleTheme } = useAppTheme('admin');

  useEffect(() => {
    let active = true;
    currentAccount()
      .then(({ account }) => {
        if (!active) return;
        if (account.role !== 'admin') {
          setError('Administrator access is required for this page.');
          setLoading(false);
          return;
        }
        if (account.name) setCurrentUser({ name: account.name, role: account.role });
        setSessionReady(true);
      })
      .catch(cause => {
        if (!active) return;
        if (cause instanceof ApiRequestError && cause.status === 401) {
          navigate('/login', { replace: true });
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Could not check the current session.');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const loadDashboard = useCallback(
    async (force = false) => {
      if (!dashboardRef.current) setLoading(true);
      setError('');
      try {
        const data = await loadDashboardCached<Dashboard>(
          () => apiRequest<Dashboard>('/api/admin/dashboard'),
          force,
        );
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
      } finally {
        setLoading(false);
      }
    },
    [navigate],
  );

  useEffect(() => {
    const activePath = location.pathname === '/admin.html' ? '/admin' : location.pathname.replace(/\/$/, '') || '/admin';
    if (sessionReady && activePath === '/admin') void loadDashboard();
  }, [location.pathname, loadDashboard, sessionReady]);

  const currentPath = location.pathname === '/admin.html' ? '/admin' : location.pathname.replace(/\/$/, '') || '/admin';
  const activeItem = groups
    .flatMap(group => group.items)
    .find(
      item =>
        item.path === currentPath ||
        (item.path === '/admin/students' && currentPath.startsWith('/admin/students/')) ||
        (item.path === '/admin/staff' && currentPath.startsWith('/admin/staff/')) ||
        (item.path === '/admin/reports' && currentPath.startsWith('/admin/reports')),
    );
  const pageTitle = activeItem?.label || 'Dashboard';
  const searchMatches = useMemo(
    () =>
      globalSearch.trim()
        ? groups
            .flatMap(group => group.items)
            .filter(item => item.label.toLowerCase().includes(globalSearch.toLowerCase()))
            .slice(0, 6)
        : [],
    [globalSearch],
  );

  async function signOut() {
    try {
      await logout();
    } finally {
      navigate('/login', { replace: true });
    }
  }
  function openPage(path: string) {
    navigate(path);
    setSidebarOpen(false);
    setGlobalSearch('');
  }
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const navigateSidebar = useCallback(() => {
    setSidebarOpen(false);
    setGlobalSearch('');
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 dark:bg-[#0b0f19] dark:text-slate-100">
      <Helmet>
        <title>{pageTitle} | My JEE Mentor</title>
        <meta
          name="description"
          content={`My JEE Mentor Institute Workspace — ${pageTitle} management and live overview.`}
        />
      </Helmet>

      <AdminSidebar
        groups={groups}
        currentPath={currentPath}
        sidebarOpen={sidebarOpen}
        onClose={closeSidebar}
        onNavigate={navigateSidebar}
        user={currentUser}
      />
      {sidebarOpen && (
        <button
          aria-label="Close menu overlay"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm lg:hidden"
        />
      )}

      <div className="min-h-screen lg:pl-[335px]">
        {/* Navbar / Header with Search & Dark Mode Toggle */}
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/90 sm:px-7">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Open navigation"
          >
            <AdminIcon name="menu" className="h-5 w-5" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              My JEE Mentor / Admin
            </p>
            <h1 className="truncate text-lg font-black tracking-tight text-slate-900 dark:text-white">
              {pageTitle}
            </h1>
          </div>

          {/* Search Box */}
          <div className="relative hidden w-56 md:block xl:w-72">
            <span className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500">
              <AdminIcon name="search" className="h-4 w-4" />
            </span>
            <input
              aria-label="Global search"
              value={globalSearch}
              onChange={event => setGlobalSearch(event.target.value)}
              placeholder="Search pages..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-orange-500"
            />
            {searchMatches.length > 0 && (
              <div className="absolute left-0 right-0 top-12 z-30 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                {searchMatches.map(item => (
                  <button
                    key={item.path}
                    onClick={() => openPage(item.path)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-orange-50 hover:text-orange-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-orange-400"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dark Mode Toggle in Header */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 hover:text-orange-600 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-orange-400"
          >
            <AdminIcon name={theme === 'dark' ? 'sun' : 'moon'} className="h-5 w-5" />
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotificationsOpen(value => !value)}
              aria-label="Notifications"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <AdminIcon name="bell" className="h-5 w-5" />
            </button>
            {notificationsOpen && (
              <div className="absolute right-0 top-12 z-30 w-64 rounded-2xl border border-slate-200 bg-white p-4 text-sm shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <b className="font-bold text-slate-800 dark:text-white">Notifications</b>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No new notifications.</p>
              </div>
            )}
          </div>

          {/* Settings */}
          <button
            onClick={() => openPage('/admin/settings')}
            aria-label="Settings"
            className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 sm:grid"
          >
            <AdminIcon name="settings" className="h-5 w-5" />
          </button>

          {/* Log out */}
          <button
            onClick={() => void signOut()}
            className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 active:scale-95 dark:bg-slate-800 dark:hover:bg-slate-700 sm:px-4 sm:text-sm"
          >
            Log out
          </button>
        </header>

        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 xl:p-8">
          {currentPath === '/admin/ptm' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading parent meetings..." />}>
              <AdminPtmPage />
            </Suspense>
          ) : currentPath === '/admin/integrations' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading integrations…" />}>
              <AdminIntegrationsPage />
            </Suspense>
          ) : currentPath === '/admin/batches' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading batches..." />}>
              <AdminBatchesPage />
            </Suspense>
          ) : currentPath === '/admin/work-shifts' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading work shifts..." />}>
              <AdminWorkShiftsPage />
            </Suspense>
          ) : currentPath === '/admin/faculty-performance' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading faculty performance..." />}>
              <AdminFacultyPerformancePage />
            </Suspense>
          ) : currentPath.startsWith('/admin/finance') ||
            [
              '/admin/fees',
              '/admin/fee-structures',
              '/admin/discounts',
              '/admin/late-fees',
              '/admin/payment-reminders',
              '/admin/deletion-audit',
              '/admin/accounting-export',
              '/admin/expenses',
              '/admin/expense-heads',
              '/admin/income',
              '/admin/income-heads',
            ].includes(currentPath) ||
            currentPath === '/admin/fees/report' ||
            currentPath.startsWith('/admin/expenses/') ||
            currentPath.startsWith('/admin/income/') ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading Finance workspace…" />}>
              <AdminFinancePage key={currentPath} />
            </Suspense>
          ) : currentPath.startsWith('/admin/payroll') ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading payroll workspace…" />}>
              <AdminPayrollPage key={currentPath} />
            </Suspense>
          ) : currentPath === '/admin/staff-attendance' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading staff attendance…" />}>
              <AdminStaffAttendancePage />
            </Suspense>
          ) : currentPath.startsWith('/admin/staff') ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading staff workspace…" />}>
              <AdminStaffPage />
            </Suspense>
          ) : currentPath.startsWith('/admin/students') ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading student workspace…" />}>
              <AdminStudentsPage />
            </Suspense>
          ) : currentPath === '/admin/online-admissions' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading admissions workspace…" />}>
              <AdminAdmissionsPage />
            </Suspense>
          ) : [
              '/admin/academic-years',
              '/admin/courses',
              '/admin/subjects',
              '/admin/topics',
              '/admin/batches',
            ].includes(currentPath) ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading curriculum workspace…" />}>
              <AdminCurriculumPage key={currentPath} />
            </Suspense>
          ) : currentPath === '/admin/homework' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading homework workspace…" />}>
              <AdminAcademicsPartBPage key={currentPath} />
            </Suspense>
          ) : currentPath === '/admin/doubts' ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading doubts workspace…" />}>
              <AdminDoubtsPage />
            </Suspense>
          ) : ['/admin/attendance', '/admin/timetable', '/admin/leave-holidays'].includes(currentPath) ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading academics workspace…" />}>
              <AdminAcademicsPartAPage key={currentPath} />
            </Suspense>
          ) : ['/admin/download-center', '/admin/video-lectures', '/admin/live-classes'].includes(currentPath) ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading content workspace…" />}>
              <AdminContentMediaPage key={currentPath} />
            </Suspense>
          ) : currentPath.startsWith('/admin/reports') ? (
            <Suspense fallback={<RouteLoadingSpinner message="Loading reports workspace…" />}>
              <AdminReportsPage key={currentPath} />
            </Suspense>
          ) : currentPath !== '/admin' ? (
            <section className="grid min-h-[60vh] place-items-center">
              <div className="max-w-md rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400">
                  <AdminIcon name="star" className="h-6 w-6" />
                </span>
                <h2 className="mt-5 text-2xl font-black text-slate-800 dark:text-white">{pageTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  This area is ready for record management. Your existing institute records remain available.
                </p>
                <button
                  onClick={() => navigate('/admin')}
                  className="mt-6 rounded-xl bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-orange-600 active:scale-95 transition"
                >
                  Back to dashboard
                </button>
              </div>
            </section>
          ) : loading ? (
            <DashboardSkeleton />
          ) : error ? (
            <div
              role="alert"
              className="rounded-3xl border border-rose-200 bg-white p-8 shadow-sm dark:border-rose-950/50 dark:bg-slate-900"
            >
              <h2 className="text-lg font-extrabold text-rose-800 dark:text-rose-400">
                Dashboard data could not be loaded
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error}</p>
              <button
                onClick={() => void loadDashboard(true)}
                className="mt-5 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-600 active:scale-95 transition"
              >
                Try again
              </button>
            </div>
          ) : (
            dashboard && <DashboardView data={dashboard} onAction={openPage} onRefresh={() => void loadDashboard(true)} />
          )}
        </main>
      </div>
    </div>
  );
}

function RouteLoadingSpinner({ message }: { message: string }) {
  return (
    <div role="status" className="grid min-h-[55vh] place-items-center">
      <div className="text-center">
        <span className="mx-auto block h-9 w-9 animate-spin rounded-full border-4 border-orange-100 border-t-orange-500 dark:border-slate-800 dark:border-t-orange-400" />
        <p className="mt-4 text-sm font-semibold text-slate-500 dark:text-slate-400">{message}</p>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-28 rounded-3xl bg-slate-200 dark:bg-slate-800" />
      <div className="grid gap-5 2xl:grid-cols-[1.25fr_1fr]">
        <div className="h-64 rounded-3xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid gap-5 2xl:grid-cols-[1.45fr_.75fr]">
        <div className="h-72 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-72 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}

function DashboardView({
  data,
  onAction,
  onRefresh,
}: {
  data: Dashboard;
  onAction: (path: string) => void;
  onRefresh: () => void;
}) {
  const [period, setPeriod] = useState<'Monthly' | 'Quarterly' | 'Yearly'>('Monthly');
  const [demographic, setDemographic] = useState<'Gender' | 'States' | 'Cities'>('Gender');

  const setupPercent = data.setup.total ? Math.round((data.setup.completed * 100) / data.setup.total) : 0;
  const nextStep = data.setup.steps.find(step => !step.complete);

  const demographicData =
    demographic === 'Gender'
      ? data.demographics.gender
      : demographic === 'States'
        ? data.demographics.states
        : data.demographics.cities;

  const quickActionsList = [
    { label: 'Add Student', path: '/admin/students' },
    { label: 'New Exam', path: '/admin/online-exams' },
    { label: 'Attendance', path: '/admin/attendance' },
    { label: 'Fees', path: '/admin/fees' },
    { label: 'Broadcast', path: '/admin/broadcast' },
    { label: 'Homework', path: '/admin/homework' },
    { label: 'Lead CRM', path: '/admin/leads' },
    { label: 'Reports', path: '/admin/reports' },
  ];

  const panel = (
    title: string,
    icon: string,
    children: React.ReactNode,
    action?: [string, string],
    className = '',
    iconColor = 'text-orange-500',
  ) => (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      <header className="flex min-h-[56px] items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-800/40">
        <h2 className="flex items-center gap-2.5 text-[15px] font-black text-slate-800 dark:text-slate-100">
          <AdminIcon name={icon} className={`h-5 w-5 ${iconColor}`} />
          {title}
        </h2>
        {action && (
          <button
            onClick={() => onAction(action[1])}
            className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline dark:text-orange-400 dark:hover:text-orange-300"
          >
            {action[0]} →
          </button>
        )}
      </header>
      {children}
    </section>
  );

  const listEmpty = (message: string) => (
    <div className="grid min-h-36 place-content-center px-4 text-center text-sm text-slate-400 dark:text-slate-500">
      <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-slate-50 text-slate-300 dark:bg-slate-800 dark:text-slate-600">
        <AdminIcon name="inbox" className="h-6 w-6" />
      </span>
      {message}
    </div>
  );

  const dateLabel = (value: string | null) =>
    value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  const chartData = useMemo(() => {
    if (period === 'Monthly') return data.enrollment;
    if (period === 'Quarterly') {
      const grouped = data.enrollment.reduce<Record<string, { label: string; count: number }>>((all, item) => {
        const key = `${item.year}-Q${item.quarter}`;
        all[key] ??= { label: `Q${item.quarter} ${item.year}`, count: 0 };
        all[key].count += item.count;
        return all;
      }, {});
      return Object.values(grouped);
    }
    const grouped = data.enrollment.reduce<Record<string, { label: string; count: number }>>((all, item) => {
      const key = String(item.year);
      all[key] ??= { label: key, count: 0 };
      all[key].count += item.count;
      return all;
    }, {});
    return Object.values(grouped);
  }, [data.enrollment, period]);

  const chartValues = chartData.map(item => item.count);
  const collectedRate =
    data.stats.feePending + data.stats.feesCollected > 0
      ? Math.round((data.stats.feesCollected * 100) / (data.stats.feePending + data.stats.feesCollected))
      : 0;

  const formattedDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-6">
      {/* 1. Setup Progress Banner matching Screenshot 1 (Orange theme) */}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/15 dark:from-orange-700 dark:via-orange-600 dark:to-amber-700">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6 sm:p-7">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/20 backdrop-blur-md">
              <AdminIcon name="school" className="h-7 w-7 text-white" />
            </span>
            <div>
              <h2 className="text-lg font-black tracking-tight sm:text-xl">
                Setup Progress — {data.setup.completed}/{data.setup.total} steps complete
              </h2>
              <p className="mt-0.5 text-xs font-medium text-orange-100">
                {nextStep ? `Next: ${nextStep.label} · ${nextStep.description}` : 'Your institute setup is complete.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <strong className="text-3xl font-black tracking-tight sm:text-4xl">{setupPercent}%</strong>
            <button
              onClick={() => nextStep && onAction(setupPath(nextStep.label))}
              disabled={!nextStep}
              className="rounded-xl bg-white px-5 py-3 text-sm font-black text-orange-600 shadow-md transition hover:bg-orange-50 active:scale-95 disabled:opacity-60"
            >
              {nextStep ? `Continue: ${nextStep.label}` : 'Setup complete'}
            </button>
          </div>
        </div>

        {/* 16 Segmented Progress Capsules */}
        <div
          className="grid gap-1.5 px-6 pb-5 pt-1"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, data.setup.total)}, minmax(0, 1fr))` }}
        >
          {data.setup.steps.map((step, idx) => (
            <span
              key={`${step.label}-${idx}`}
              title={`${step.complete ? 'Completed' : 'Pending'}: ${step.label}`}
              className={`h-2 rounded-full transition-all duration-300 ${
                step.complete ? 'bg-emerald-300 shadow-sm shadow-emerald-400/50' : 'bg-white/20'
              }`}
            />
          ))}
        </div>
      </section>

      {/* 2. Hero Card + 4 Stat Cards */}
      <section className="grid gap-5 2xl:grid-cols-[1.25fr_1fr]">
        {/* Hero Card */}
        <article className="relative flex min-h-[250px] flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-orange-500 via-orange-600 to-amber-600 p-7 text-white shadow-lg shadow-orange-500/15 dark:from-orange-600 dark:via-orange-700 dark:to-amber-800 md:flex-row md:items-center">
          <div className="z-10 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-200" />
              <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-orange-100">
                Institute Dashboard
              </p>
            </div>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">JEE Mentor</h2>
            <div className="mt-2.5 flex items-center gap-2 text-xs font-medium text-orange-100/90">
              <AdminIcon name="calendar" className="h-4 w-4 shrink-0 text-orange-200" />
              <span>{formattedDate}</span>
            </div>
            <p className="mt-2 text-xs font-medium text-orange-100/80">
              Live overview from your institute records.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3.5 py-1.5 text-xs font-bold backdrop-blur-sm">
                <AdminIcon name="student" className="h-3.5 w-3.5 text-orange-200" />
                {number(data.stats.students)} Students
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-black/20 px-3.5 py-1.5 text-xs font-bold backdrop-blur-sm">
                <AdminIcon name="payment" className="h-3.5 w-3.5 text-emerald-300" />
                {money(data.stats.feesCollected)} This Month
              </span>
            </div>
          </div>
          <div className="relative mt-4 flex shrink-0 justify-center md:mt-0">
            <img
              src={welcomeIllustration}
              alt="JEE Mentor Dashboard"
              width="340"
              height="220"
              className="max-h-[190px] w-auto select-none object-contain drop-shadow-xl transition-transform duration-300 hover:scale-105"
              loading="eager"
            />
          </div>
        </article>

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Students */}
          <button
            type="button"
            onClick={() => onAction('/admin/students')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-3xl font-black tracking-tight text-slate-800 dark:text-white">
                  {number(data.stats.students)}
                </span>
                <span className="mt-1 block text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  STUDENTS
                </span>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-orange-600 transition group-hover:scale-110 dark:bg-orange-950/50 dark:text-orange-400">
                <AdminIcon name="student" className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                {data.stats.students > 0 ? `+${number(data.stats.students)} this month` : `${number(data.stats.activeStudents)} active`}
              </span>
              <div className="w-24">
                <StatSparkline color="orange" />
              </div>
            </div>
          </button>

          {/* Revenue */}
          <button
            type="button"
            onClick={() => onAction('/admin/fees')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-3xl font-black tracking-tight text-emerald-600 dark:text-emerald-400">
                  {money(data.stats.feesCollected)}
                </span>
                <span className="mt-1 block text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  REVENUE (MONTH)
                </span>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 transition group-hover:scale-110 dark:bg-emerald-950/50 dark:text-emerald-400">
                <AdminIcon name="payment" className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                {money(data.stats.feePending)} pending
              </span>
              <div className="w-24">
                <StatSparkline color="green" />
              </div>
            </div>
          </button>

          {/* At-Risk Students */}
          <button
            type="button"
            onClick={() => onAction('/admin/reports')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-3xl font-black tracking-tight text-rose-600 dark:text-rose-400">
                  {number(data.stats.atRisk)}
                </span>
                <span className="mt-1 block text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  AT-RISK STUDENTS
                </span>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-600 transition group-hover:scale-110 dark:bg-rose-950/50 dark:text-rose-400">
                <AdminIcon name="warning" className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400">
                Needs attention
              </span>
              <div className="w-24">
                <StatSparkline color="red" />
              </div>
            </div>
          </button>

          {/* Fee Collection Rate */}
          <button
            type="button"
            onClick={() => onAction('/admin/fees')}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-3xl font-black tracking-tight text-cyan-600 dark:text-cyan-400">
                  {collectedRate}%
                </span>
                <span className="mt-1 block text-[11px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  FEE COLLECTION
                </span>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-600 transition group-hover:scale-110 dark:bg-cyan-950/50 dark:text-cyan-400">
                <AdminIcon name="chart" className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                {data.stats.paymentsThisMonth} payments this month
              </span>
              <div className="w-24">
                <StatSparkline color="cyan" />
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* 3. 8 Quick Action Tiles matching Screenshot 1 */}
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4 lg:grid-cols-8">
        {quickActionsList.map(item => (
          <button
            key={item.label}
            type="button"
            onClick={() => onAction(item.path)}
            className="group flex min-h-[105px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-slate-100 bg-white p-3 text-center shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="transition-transform duration-200 group-hover:scale-110">
              <DashboardActionIcon name={item.label} className="h-8 w-8" />
            </div>
            <span className="text-xs font-bold text-slate-700 transition group-hover:text-orange-600 dark:text-slate-300 dark:group-hover:text-orange-400">
              {item.label}
            </span>
          </button>
        ))}
      </section>

      {/* 4. Student Enrollment Trend + Demographics Charts */}
      <section className="grid gap-5 2xl:grid-cols-[1.45fr_.75fr]">
        {panel(
          'Student Enrollment Trend',
          'pulse',
          <div className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                Historical & current enrollments
              </span>
              <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(['Monthly', 'Quarterly', 'Yearly'] as const).map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setPeriod(item)}
                    className={`rounded-lg px-3 py-1 text-xs font-bold transition-all duration-150 ${
                      period === item
                        ? 'bg-orange-500 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <EnrollmentTrendChart data={chartData} />
          </div>,
          undefined,
          '',
          'text-rose-500',
        )}

        {panel(
          'Demographics',
          'chart',
          <div className="p-4 sm:p-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 dark:text-slate-500">
                Student distribution
              </span>
              <div className="inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {(['Gender', 'States', 'Cities'] as const).map(item => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setDemographic(item)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold transition-all duration-150 ${
                      demographic === item
                        ? 'bg-orange-500 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <DemographicsDonutChart data={demographicData} demographic={demographic} />
          </div>,
          undefined,
          '',
          'text-orange-500',
        )}
      </section>

      {/* 5. Recent Transactions + Recent Inquiries & CRM Leads */}
      <section className="grid gap-5 xl:grid-cols-2">
        {panel(
          'Recent Transactions',
          'payment',
          data.recentTransactions.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.recentTransactions.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                    <AdminIcon name="payment" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                      {item.student}
                    </b>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {item.description}
                      {item.method ? ` · ${item.method}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <b className="block text-sm font-black text-emerald-600 dark:text-emerald-400">
                      +{money(item.amount)}
                    </b>
                    <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                      {dateLabel(item.date)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            listEmpty('No transactions recorded yet')
          ),
          ['View Ledger', '/admin/fees'],
          '',
          'text-emerald-500',
        )}

        {panel(
          'Recent Inquiries & CRM Leads',
          'funnel',
          data.recentAdmissions.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.recentAdmissions.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
                    <AdminIcon name="addPerson" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                      {item.name}
                    </b>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {item.batch || 'Admission inquiry'} · <span className="capitalize">{item.status}</span>
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                    {dateLabel(item.date)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            listEmpty('No leads or inquiries yet')
          ),
          ['Go to CRM', '/admin/leads'],
          '',
          'text-purple-500',
        )}
      </section>

      {/* 6. Predictive Insights */}
      <section className="rounded-3xl bg-gradient-to-r from-orange-500 via-orange-600 to-amber-600 p-6 text-white shadow-lg shadow-orange-500/15 dark:from-orange-600 dark:via-orange-700 dark:to-amber-800 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black tracking-tight">Predictive Insights</h2>
            <p className="mt-1 text-xs font-medium text-orange-100">
              Enrollment estimate from recent saved enrollment history
            </p>
          </div>
          <button
            onClick={() => onRefresh()}
            className="rounded-xl border border-white/30 px-3.5 py-1.5 text-xs font-bold transition hover:bg-white/20 active:scale-95"
          >
            ↻ Refresh
          </button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {data.forecast.map((count, index) => (
            <div key={index} className="rounded-2xl border border-white/15 bg-white/10 p-4 text-center backdrop-blur-sm">
              <b className="text-3xl font-black">{number(count)}</b>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-orange-100">
                {new Date(new Date().getFullYear(), new Date().getMonth() + index + 1, 1).toLocaleDateString(
                  undefined,
                  { month: 'short', year: 'numeric' },
                )}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 text-center backdrop-blur-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-orange-100">Peak months</p>
            <b className="mt-1.5 block text-sm font-black">
              {data.peakMonths.length ? data.peakMonths.join(', ') : 'Not enough history'}
            </b>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 text-center backdrop-blur-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-orange-100">Attendance risk</p>
            <b className="mt-1.5 block text-2xl font-black">
              {data.stats.students ? `${Math.round((data.stats.atRisk * 100) / data.stats.students)}%` : '—'}
            </b>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 text-center backdrop-blur-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-orange-100">Enrollment trend</p>
            <b className="mt-1.5 block text-sm font-black">
              {chartValues.length > 1 && chartValues[chartValues.length - 1] > chartValues[0]
                ? '↑ Growing'
                : chartValues.length > 1 && chartValues[chartValues.length - 1] < chartValues[0]
                  ? '↓ Declining'
                  : '→ Stable'}
            </b>
          </div>
        </div>
      </section>

      {/* 7. Revenue Last 6 Months + Today's Classes */}
      <section className="grid gap-5 2xl:grid-cols-[1.45fr_.75fr]">
        {panel(
          'Revenue — Last 6 Months',
          'chart',
          <div className="p-4 sm:p-5">
            <div className="mb-2 flex justify-between text-xs font-semibold text-slate-500 dark:text-slate-400">
              <span>{collectedRate}% collected against recorded fees</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">
                {money(data.stats.feePending)} pending
              </span>
            </div>
            {data.feeCollection.some(item => item.amount > 0) ? (
              <BarChart
                values={data.feeCollection.map(item => item.amount)}
                labels={data.feeCollection.map(item => item.label)}
              />
            ) : (
              listEmpty('No fee collection records yet')
            )}
          </div>,
          ['Open Fee Collection', '/admin/fees'],
          '',
          'text-emerald-500',
        )}

        {panel(
          "Today's Classes",
          'event',
          <>
            <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span>Today's attendance split</span>
                <span>
                  {data.todayAttendance.total
                    ? `${data.todayAttendance.present}/${data.todayAttendance.total} present`
                    : 'Unmarked'}
                </span>
              </div>
              <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${
                      data.todayAttendance.total
                        ? (data.todayAttendance.present * 100) / data.todayAttendance.total
                        : 0
                    }%`,
                  }}
                />
              </div>
              <div className="mt-2 flex justify-between text-xs">
                <span className="text-slate-400 dark:text-slate-500">
                  {data.todayAttendance.total ? 'Attendance saved today' : 'No student records submitted today'}
                </span>
                <button
                  onClick={() => onAction('/admin/attendance')}
                  className="font-bold text-orange-600 hover:underline dark:text-orange-400"
                >
                  Mark now →
                </button>
              </div>
            </div>
            {data.todayClasses.length ? (
              <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
                {data.todayClasses.map(item => (
                  <p key={item.id} className="flex justify-between py-3 text-sm">
                    <b className="font-bold text-slate-800 dark:text-slate-100">{item.name}</b>
                    <span className="text-slate-500 dark:text-slate-400">{item.time}</span>
                  </p>
                ))}
              </div>
            ) : (
              listEmpty('No classes today')
            )}
          </>,
          ['Timetable', '/admin/timetable'],
          '',
          'text-orange-500',
        )}
      </section>

      {/* 8. Birthdays */}
      <section className="grid gap-5 xl:grid-cols-2">
        {panel(
          "Today's Student Birthdays",
          'birthday',
          data.studentBirthdays.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.studentBirthdays.map(item => (
                <p key={item.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-pink-50 font-bold text-pink-600 dark:bg-pink-950/50 dark:text-pink-400">
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <b className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.name}</b>
                </p>
              ))}
            </div>
          ) : (
            listEmpty('No student birthdays today')
          ),
          undefined,
          '',
          'text-pink-500',
        )}

        {panel(
          "Today's Staff Birthdays",
          'birthday',
          data.staffBirthdays.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.staffBirthdays.map(item => (
                <p key={item.id} className="flex items-center gap-3 py-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 font-bold text-orange-600 dark:bg-orange-950/50 dark:text-orange-400">
                    {item.name.slice(0, 1).toUpperCase()}
                  </span>
                  <b className="text-sm font-bold text-slate-800 dark:text-slate-100">{item.name}</b>
                </p>
              ))}
            </div>
          ) : (
            listEmpty('No staff birthdays today')
          ),
          undefined,
          '',
          'text-orange-500',
        )}
      </section>

      {/* 9. Exams, At-Risk, Performers, Homework */}
      <section className="grid gap-5 xl:grid-cols-2">
        {panel(
          'Upcoming Exams',
          'quiz',
          data.upcomingExams.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.upcomingExams.map(item => (
                <p key={item.id} className="flex justify-between py-3 text-sm">
                  <b className="font-bold text-slate-800 dark:text-slate-100">{item.name}</b>
                  <span className="text-slate-500 dark:text-slate-400">{dateLabel(item.date)}</span>
                </p>
              ))}
            </div>
          ) : (
            listEmpty('No upcoming exams')
          ),
          undefined,
          '',
          'text-amber-500',
        )}

        {panel(
          'At-Risk Students',
          'warning',
          data.atRiskStudents.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.atRiskStudents.map(item => (
                <div key={item.id} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <b className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">
                        {item.name}
                      </b>
                      <span className="text-xs uppercase text-slate-400 dark:text-slate-500">
                        {item.batch || 'No batch assigned'}
                      </span>
                    </div>
                    <b className="text-sm font-black text-rose-600 dark:text-rose-400">{item.attendance}%</b>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-rose-100 dark:bg-rose-950/60">
                    <div
                      className="h-full rounded-full bg-rose-500 transition-all duration-300"
                      style={{ width: `${item.attendance}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            listEmpty('No at-risk students from recent attendance')
          ),
          ['View all', '/admin/reports'],
          '',
          'text-rose-500',
        )}

        {panel(
          'Top Performers',
          'verified',
          data.topPerformers.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.topPerformers.map(item => (
                <p key={item.id} className="flex justify-between py-3 text-sm">
                  <span>
                    <b className="font-bold text-slate-800 dark:text-slate-100">{item.name}</b>
                    <small className="ml-2 text-slate-400 dark:text-slate-500">{item.batch}</small>
                  </span>
                  <b className="font-black text-amber-600 dark:text-amber-400">{item.score}%</b>
                </p>
              ))}
            </div>
          ) : (
            listEmpty('No exam results recorded yet')
          ),
          undefined,
          '',
          'text-amber-500',
        )}

        {panel(
          'Active Homework',
          'book',
          data.activeHomework.length ? (
            <div className="divide-y divide-slate-100 px-4 dark:divide-slate-800">
              {data.activeHomework.map(item => (
                <p key={item.id} className="flex justify-between gap-3 py-3 text-sm">
                  <span>
                    <b className="block font-bold text-slate-800 dark:text-slate-100">{item.title}</b>
                    <small className="text-slate-400 dark:text-slate-500">{item.batch}</small>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {item.due ? `Due ${dateLabel(item.due)}` : item.status}
                  </span>
                </p>
              ))}
            </div>
          ) : (
            listEmpty('No active homework')
          ),
          ['View all', '/admin/homework'],
          '',
          'text-sky-500',
        )}
      </section>

      <footer className="border-t border-slate-200/80 py-6 text-center text-xs font-semibold text-slate-400 dark:border-slate-800 dark:text-slate-500">
        © {new Date().getFullYear()} My JEE Mentor · All Rights Reserved
      </footer>
    </div>
  );
}

function setupPath(label: string) {
  const value = label.toLowerCase();
  return value.includes('academic')
    ? '/admin/academic-years'
    : value.includes('course')
      ? '/admin/courses'
      : value.includes('batch')
        ? '/admin/batches'
        : value.includes('student')
          ? '/admin/students'
          : value.includes('staff')
            ? '/admin/staff'
            : value.includes('admission')
              ? '/admin/online-admissions'
              : value.includes('subject')
                ? '/admin/subjects'
                : value.includes('topic')
                  ? '/admin/topics'
                  : value.includes('fee') || value.includes('payment')
                    ? '/admin/fees'
                    : value.includes('broadcast')
                      ? '/admin/broadcast'
                      : value.includes('homework')
                        ? '/admin/homework'
                        : value.includes('payroll')
                          ? '/admin/payroll'
                          : '/admin/settings';
}

function BarChart({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-[245px] items-end justify-between gap-2 px-1 pt-5">
      {values.map((value, index) => (
        <div key={`${labels[index]}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
            {value ? money(value) : '—'}
          </span>
          <div
            title={`${labels[index]}: ${money(value)}`}
            style={{ height: `${Math.max((value / max) * 145, value ? 8 : 4)}px` }}
            className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-sm transition-all duration-300 dark:from-emerald-700 dark:to-emerald-500"
          />
          <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}
