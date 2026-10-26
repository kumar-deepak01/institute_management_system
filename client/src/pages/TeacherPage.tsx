import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import AdminIcon from '../components/AdminIcon';
import PtmMeetingNotices from '../components/PtmMeetingNotices';
import { currentAccount, logout } from '../services/auth';
import { deleteTeacherPage, fetchTeacherPayslip, getTeacherContext, getTeacherPage, saveTeacherPage, uploadTeacherFile, type TeacherContext } from '../services/teacher';
import { AnimatedCount, MagneticButton, TiltCard } from './TeacherEffects';
import TeacherPageHead from './TeacherPageHead';
import TeacherBrand from './TeacherBrand';
import { applyTeacherTheme, getInitialTeacherTheme, type TeacherThemeMode } from './TeacherTheme';
import './TeacherPage.css';

type Row = Record<string, any>;
type NavItem = { title: string; path: string; icon: string };
const groups: Array<{ title: string; items: NavItem[] }> = [
  { title: 'OVERVIEW', items: [{ title: 'Dashboard', path: '/teacher/dashboard', icon: 'dashboard' }, { title: 'My Students', path: '/teacher/students', icon: 'student' }] },
  { title: 'TEACHING', items: [{ title: 'My Timetable', path: '/teacher/timetable', icon: 'calendar' }, { title: 'Attendance', path: '/teacher/attendance', icon: 'checklist' }, { title: 'Homework', path: '/teacher/homework', icon: 'pencil' }, { title: 'Exams', path: '/teacher/exams', icon: 'quiz' }, { title: 'Results', path: '/teacher/results', icon: 'report' }, { title: 'Shared Files', path: '/teacher/shared-files', icon: 'download' }] },
  { title: 'ACCOUNT', items: [{ title: 'My Profile', path: '/teacher/profile', icon: 'person' }, { title: 'Leave & Holidays', path: '/teacher/leave', icon: 'eventOff' }, { title: 'My Payments', path: '/teacher/payslips', icon: 'payment' }] },
];
const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50';
const panelClass = 'overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-[0_4px_14px_rgba(30,64,175,.06)]';
const today = () => new Date().toISOString().slice(0, 10);
const prettyDate = (value: string) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : '';
const money = (value: number) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pageForPath = (path: string) => path.replace(/^\/teacher\/?/, '').split('/')[0] || 'dashboard';
const titleFor = (page: string) => groups.flatMap(group => group.items).find(item => item.path.split('/').pop() === page)?.title || 'Dashboard';

export default function TeacherPage() {
  return <HelmetProvider><TeacherWorkspace /></HelmetProvider>;
}

function TeacherWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageForPath(location.pathname);
  const [account, setAccount] = useState<Row | null>(null);
  const [context, setContext] = useState<TeacherContext | null>(null);
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [data, setData] = useState<Row>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [globalSearch, setGlobalSearch] = useState('');
  const [dialog, setDialog] = useState('');
  const [activeItem, setActiveItem] = useState<Row | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [attendanceBatch, setAttendanceBatch] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [attendance, setAttendance] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<TeacherThemeMode>(getInitialTeacherTheme);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.teacherRoute = 'true';
    return () => {
      delete document.documentElement.dataset.teacherRoute;
      delete document.documentElement.dataset.teacherTheme;
    };
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { storage = undefined; }
    applyTeacherTheme(theme, document.documentElement, storage);
  }, [theme]);

  useEffect(() => { if (location.pathname === '/teacher' || location.pathname === '/teacher/') navigate('/teacher/dashboard', { replace: true }); }, [location.pathname, navigate]);
  useEffect(() => { let alive = true; currentAccount().then(result => { if (alive) setAccount(result.account); }).catch(() => undefined); return () => { alive = false; }; }, []);
  useEffect(() => {
    let alive = true;
    setError('');
    setLoading(true);
    Promise.allSettled([getTeacherContext(), getTeacherPage<Row>('dashboard')]).then(([ctx, stats]) => {
      if (!alive) return;
      if (ctx.status === 'fulfilled') { setContext(ctx.value); setAttendanceBatch(current => current || ctx.value.batches[0]?.id || ''); }
      if (stats.status === 'fulfilled') setDashboard(stats.value);
      if (ctx.status === 'rejected' && stats.status === 'rejected') setError('Teacher workspace could not be loaded. Please retry.');
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh]);

  const loadPage = useCallback(async () => {
    if (page === 'dashboard' || page === 'profile') { if (page === 'profile') setData({ profile: context?.profile || {} }); return; }
    setLoading(true); setError('');
    try {
      let result: Row;
      if (page === 'attendance') result = await getTeacherPage<Row>('attendance', `?batchId=${encodeURIComponent(attendanceBatch)}&date=${encodeURIComponent(attendanceDate)}`);
      else if (page === 'students') result = await getTeacherPage<Row>('students', appliedQuery ? `?q=${encodeURIComponent(appliedQuery)}` : '');
      else result = await getTeacherPage<Row>(page);
      setData(result || {});
      if (page === 'attendance') setAttendance(Object.fromEntries((result.records || []).map((row: Row) => [row.studentKey, row.status || 'Absent'])));
    } catch (cause) { setError(cause instanceof Error ? cause.message : `${titleFor(page)} could not be loaded.`); setData({}); }
    finally { setLoading(false); }
  }, [page, context, attendanceBatch, attendanceDate, appliedQuery]);
  useEffect(() => { void loadPage(); }, [loadPage, refresh]);

  const go = (path: string) => { navigate(path); setMobileOpen(false); setError(''); setNotice(''); };
  const refreshAll = () => setRefresh(value => value + 1);
  const perform = async (task: () => Promise<unknown>, success: string, after?: () => void) => {
    setBusy(true); setError(''); setNotice('');
    try { await task(); setNotice(success); setDialog(''); after?.(); refreshAll(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This change could not be saved.'); }
    finally { setBusy(false); }
  };
  const filteredGroups = useMemo(() => groups.map(group => ({ ...group, items: group.items.filter(item => item.title.toLowerCase().includes(menuSearch.toLowerCase())) })).filter(group => group.items.length), [menuSearch]);
  const pageTitle = titleFor(page);
  const teacherName = account?.name || context?.profile?.name || 'Teacher';

  return <div className="teacher-theme min-h-screen bg-[#dfe4ee] text-slate-900" data-theme={theme}>
    <TeacherPageHead title={pageTitle} description={pageSubtitle(page)} />
    {mobileOpen && <button className="fixed inset-0 z-30 bg-slate-950/30 lg:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`teacher-sidebar fixed inset-y-0 left-0 z-40 flex w-[300px] flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`} data-collapsed="false">
      <div className="flex h-[78px] items-center border-b border-slate-100 px-5"><TeacherBrand /></div>
      <div className="border-b border-slate-100 p-4"><label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2"><AdminIcon name="search" className="h-4 w-4 text-slate-400"/><input value={menuSearch} onChange={event => setMenuSearch(event.target.value)} placeholder="Search menu..." className="min-w-0 flex-1 text-sm outline-none"/></label></div>
      <nav className="teacher-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-4">{filteredGroups.map(group => <section key={group.title}><button onClick={() => setCollapsedGroups(current => ({ ...current, [group.title]: !current[group.title] }))} aria-expanded={!collapsedGroups[group.title]} className="mb-2 flex w-full items-center justify-between px-3 text-left text-[11px] font-black tracking-[.12em] text-slate-500">{group.title}<span className="text-slate-300">{collapsedGroups[group.title]?'›':'⌄'}</span></button>{!collapsedGroups[group.title]&&<div className="space-y-1">{group.items.map(item => { const selected = pageForPath(item.path) === page; return <button key={item.path} onClick={() => go(item.path)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${selected ? 'teacher-nav-active' : 'text-slate-700 hover:bg-blue-50 hover:text-blue-700'}`}><AdminIcon name={item.icon} className="h-5 w-5 shrink-0"/>{item.title}</button>; })}</div>}</section>)}</nav>
      <div className="border-t border-slate-100 p-3"><div className="flex items-center gap-3 rounded-xl bg-blue-50 p-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">{teacherName.slice(0,2).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-bold">{teacherName}</p><p className="text-xs text-slate-500">Teacher</p></div></div></div>
    </aside>
    <div className="min-h-screen lg:pl-[300px]">
      <header className="sticky top-0 z-20 flex h-[72px] items-center gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6"><button className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><AdminIcon name="menu" className="h-5 w-5"/></button><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-400">Teacher / {pageTitle}</p><h1 className="truncate text-lg font-extrabold text-slate-800">{pageTitle}</h1></div><label className="hidden max-w-sm flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 md:flex"><AdminIcon name="search" className="h-4 w-4 text-slate-400"/><input value={globalSearch} onChange={event => setGlobalSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && globalSearch.trim()) { setQuery(globalSearch); setAppliedQuery(globalSearch); go('/teacher/students'); } }} placeholder="Search students, classes..." className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label><button aria-label="Notifications" className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500"><AdminIcon name="bell" className="h-5 w-5"/></button><button aria-label="Teaching tools" onClick={() => go('/teacher/timetable')} className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 sm:grid"><AdminIcon name="video" className="h-5 w-5"/></button><button aria-label="Settings" onClick={() => go('/teacher/profile')} className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 sm:grid"><AdminIcon name="settings" className="h-5 w-5"/></button><button type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} className="teacher-theme-toggle grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500"><AdminIcon name={theme === 'dark' ? 'sun' : 'moon'} className="teacher-theme-toggle-icon h-5 w-5"/></button><button onClick={() => void logout().finally(() => navigate('/login'))} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">Log out</button></header>
      <main className="mx-auto min-h-[calc(100vh-120px)] max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.16em] text-blue-600">{page === 'dashboard' ? 'Teacher Portal' : 'Teacher Workspace'}</p><h2 className="mt-1 text-3xl font-black text-blue-600">{page === 'dashboard' ? `Welcome, ${teacherName}! 🧑‍🏫` : pageTitle}</h2><p className="mt-1 text-sm text-slate-600">{pageSubtitle(page)}</p></div>{page === 'homework' && <MagneticButton onClick={() => { setActiveItem(null); setDialog('homework'); }} className={buttonClass}><AdminIcon name="addPerson" className="h-4 w-4"/>Assign Homework</MagneticButton>}{page === 'exams' && <MagneticButton onClick={() => { setActiveItem(null); setDialog('exam'); }} className={buttonClass}>+ Create Exam</MagneticButton>}{page === 'shared-files' && <MagneticButton onClick={() => setDialog('file')} className={buttonClass}>+ Upload File</MagneticButton>}</div>
        {error && <div role="alert" className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-white px-5 py-4 text-sm text-rose-700">{error}<button className="font-bold underline" onClick={() => { void loadPage(); refreshAll(); }}>Retry</button></div>}
        {notice && <p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
        {page === 'dashboard' && <DashboardView loading={loading} dashboard={dashboard} teacherName={teacherName} onNavigate={go}/>}
        {page === 'students' && <StudentsView data={data} loading={loading} query={query} setQuery={setQuery} onSearch={() => setAppliedQuery(query)}/>}
        {page === 'timetable' && <TimetableView data={data} loading={loading}/>}
        {page === 'attendance' && <AttendanceView context={context} data={data} loading={loading} batch={attendanceBatch} setBatch={setAttendanceBatch} date={attendanceDate} setDate={setAttendanceDate} attendance={attendance} setAttendance={setAttendance} onSave={() => void perform(() => saveTeacherPage('attendance','POST',{batchId:attendanceBatch,date:attendanceDate,records:Object.entries(attendance).map(([studentKey,status])=>({studentKey,status}))}), 'Attendance saved.', () => void loadPage())} busy={busy}/>}
        {page === 'homework' && <HomeworkView data={data} loading={loading} onAssign={() => { setActiveItem(null); setDialog('homework'); }} onReview={item => { setActiveItem(item); setDialog('submissions'); void getTeacherPage<Row>(`homework/${encodeURIComponent(item.id)}/submissions`).then(setData).catch(cause => setError(cause.message)); }}/ >}
        {page === 'exams' && <ExamsView data={data} loading={loading} onCreate={() => setDialog('exam')}/>}
        {page === 'results' && <ResultsView data={data} loading={loading}/>}
        {page === 'shared-files' && <FilesView data={data} loading={loading} onDownload={async item => { try { const result = await getTeacherPage<{url:string}>(`shared-files/${encodeURIComponent(item.id)}/download`); window.open(result.url, '_blank', 'noopener,noreferrer'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'File could not be opened.'); } }} onDelete={item => void perform(() => deleteTeacherPage(`shared-files/${encodeURIComponent(item.id)}`), 'File deleted.')}/>}
        {page === 'profile' && <ProfileView profile={context?.profile || data.profile || {}} busy={busy} onSave={value => void perform(() => saveTeacherPage('profile','PUT',value), 'Profile changes saved.', refreshAll)} onPassword={value => void perform(() => saveTeacherPage('password','POST',value), 'Password updated.')} />}
        {page === 'leave' && <LeaveView data={data} loading={loading} busy={busy} onApply={value => void perform(() => saveTeacherPage('leave','POST',value), 'Leave request submitted for approval.')}/>}
        {page === 'payslips' && <PayslipView data={data} loading={loading} onDownload={async item => { try { const blob=await fetchTeacherPayslip(item.id),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`payslip-${String(item.periodStart||'period').slice(0,7)}.pdf`;link.click();URL.revokeObjectURL(url); } catch(cause) { setError(cause instanceof Error?cause.message:'Payslip could not be downloaded.'); } }}/ >}
        {page === 'dashboard' && <div className="mt-6"><PtmMeetingNotices /></div>}
      </main>
      <footer className="flex min-h-14 items-center justify-between border-t border-slate-200 bg-white px-5 text-xs text-slate-600"><span>© 2026 My JEE Mentor</span><span>Coach Sutra v3.0</span></footer>
    </div>
    <MagneticButton className="fixed bottom-6 right-6 z-20 grid h-14 w-14 place-items-center rounded-full bg-blue-700 text-white shadow-lg shadow-blue-900/20" aria-label="Open Coach Sutra chat"><AdminIcon name="chat" className="h-6 w-6"/><span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"/></MagneticButton>
    {dialog === 'homework' && <TeacherDialog title="Assign Homework" close={() => setDialog('')}><HomeworkForm context={context} busy={busy} onSubmit={value => void perform(() => saveTeacherPage<{record:Row}>('homework','POST',value), 'Homework assigned.', () => void loadPage())}/></TeacherDialog>}
    {dialog === 'exam' && <TeacherDialog title="Create Exam" close={() => setDialog('')}><ExamForm context={context} busy={busy} onSubmit={value => void perform(() => saveTeacherPage('exams','POST',value), 'Exam created.', () => void loadPage())}/></TeacherDialog>}
    {dialog === 'file' && <TeacherDialog title="Upload Shared File" close={() => setDialog('')}><FileForm context={context} busy={busy} onSubmit={value => void perform(() => uploadTeacherFile(value.file,value.fields), 'File uploaded.', () => void loadPage())}/></TeacherDialog>}
    {dialog === 'submissions' && <TeacherDialog title={`Submissions · ${activeItem?.title || ''}`} close={() => setDialog('')}><SubmissionReview data={data} busy={busy} onReview={(row,value) => void perform(() => saveTeacherPage(`homework/${encodeURIComponent(activeItem?.id || '')}/submissions/${encodeURIComponent(row.id)}`,'PATCH',value), 'Submission reviewed.', () => { if (activeItem) void getTeacherPage<Row>(`homework/${encodeURIComponent(activeItem.id)}/submissions`).then(setData); })}/></TeacherDialog>}
  </div>;
}

function pageSubtitle(page: string) { return ({ dashboard: 'Your classes, students and daily teaching tools in one place.', students: 'Students across all your batches.', timetable: 'Your weekly class schedule.', attendance: 'Mark and review attendance for your assigned batches.', homework: 'Create assignments and review student submissions.', exams: 'Exams you have created for your batches.', results: 'Results from exams in your batches.', 'shared-files': 'Share learning resources with your batches.', profile: 'Manage your personal and professional information.', leave: 'Apply for leave and check the institute holiday calendar.', payslips: 'Download your monthly salary slips.' } as Record<string,string>)[page] || '' }
function Panel({ title, icon, children, action, tilt = true }: { title: string; icon?: string; children: ReactNode; action?: ReactNode; tilt?: boolean }) { const content = <><header className="flex items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-100 px-5 py-3.5"><h2 className="flex items-center gap-2 font-extrabold text-blue-800">{icon && <AdminIcon name={icon} className="h-5 w-5"/>}{title}</h2>{action}</header><div className="p-5">{children}</div></>; return tilt ? <TiltCard as="section" className={panelClass}>{content}</TiltCard> : <section className={`${panelClass} teacher-static-card`}>{content}</section>; }
function Empty({ title, detail }: { title: string; detail?: string }) { return <div className="grid min-h-44 place-items-center rounded-xl border border-dashed border-blue-200 bg-slate-50/50 p-6 text-center"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-400"><AdminIcon name="inbox" className="h-6 w-6"/></span><p className="mt-3 font-bold text-slate-700">{title}</p>{detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}</div></div>; }
function Metric({ label, value, sub, icon, color = 'blue' }: { label: string; value: ReactNode; sub?: string; icon: string; color?: string }) { const tones:Record<string,string>={blue:'bg-blue-50 text-blue-600',green:'bg-emerald-50 text-emerald-600',amber:'bg-amber-50 text-amber-600',purple:'bg-violet-50 text-violet-600'}; return <TiltCard as="article" className={`${panelClass} flex min-h-28 items-center gap-4 p-4`}><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tones[color]||tones.blue}`}><AdminIcon name={icon} className="h-6 w-6"/></span><div className="min-w-0"><p className="truncate text-[11px] font-black uppercase tracking-[.1em] text-slate-400">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p>{sub&&<p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>}</div></TiltCard>; }
function DashboardView({loading,dashboard,teacherName,onNavigate}:{loading:boolean;dashboard:Row|null;teacherName:string;onNavigate:(path:string)=>void}) { const stats=dashboard?.stats||{}, classes:Row[]=dashboard?.todayClasses||[], batches:Row[]=dashboard?.batches||[], reviews:Row[]=dashboard?.reviews||[]; return <>
  <TiltCard className="teacher-welcome-banner mb-5 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-700 via-blue-600 to-indigo-600 p-6 text-white shadow-md sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black tracking-[.2em] text-blue-100">TEACHER PORTAL</p><h2 className="mt-2 text-2xl font-black">Welcome, {teacherName}! 🧑‍🏫</h2><p className="mt-1 text-sm text-blue-100">{prettyDate(today())}</p></div><div className="flex gap-2"><span className="rounded-full bg-white/15 px-3 py-2 text-xs font-bold"><AnimatedCount value={Number(stats.students||0)}/> My Students</span><span className="rounded-full bg-white/15 px-3 py-2 text-xs font-bold"><AnimatedCount value={Number(stats.batches||0)}/> Batches</span></div></div></TiltCard>
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['MY STUDENTS',stats.students||0,'students','blue'],['BATCHES',stats.batches||0,'briefcase','green'],['PENDING REVIEWS',stats.pendingReviews||0,'checklist','amber'],['CLASS AVG SCORE',`${stats.classAverage||0}%`,'chart','purple']].map(([label,value,icon,color])=><Metric key={String(label)} label={String(label)} value={typeof value === 'number' ? <AnimatedCount value={value}/> : value as ReactNode} icon={String(icon)} color={String(color)}/>)}</div>
  <div className="mt-5 grid gap-5 xl:grid-cols-2"><Panel title="Batch Performance Comparison" icon="chart">{loading?<Loading/>:batches.length?<div className="space-y-4">{batches.map((batch:Row)=><div key={batch.id}><div className="mb-1 flex justify-between text-sm"><b>{batch.name}</b><span className="text-slate-500">{Number(stats.classAverage||0)}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100"><div className="teacher-animate-bar h-full rounded-full bg-blue-500" style={{width:`${Math.max(0,Math.min(100,Number(stats.classAverage||0)))}%`}}/></div></div>)}</div>:<Empty title="No batch performance yet" detail="Results will appear after your students complete exams."/>}</Panel><Panel title="Homework Evaluation Status" icon="chart">{loading?<Loading/>:<div className="flex flex-wrap items-center justify-center gap-6 py-2"><div className="grid h-36 w-36 place-items-center rounded-full" style={{background:`conic-gradient(#f97316 0deg, #f97316 ${reviews.length?90:0}deg, #e5e7eb ${reviews.length?90:360}deg)`}}><div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center"><b className="text-2xl"><AnimatedCount value={Number(stats.pendingReviews||0)}/></b><small className="text-[10px] uppercase text-slate-400">Pending</small></div></div><div className="grid grid-cols-2 gap-x-7 gap-y-3 text-sm">{[['Assigned',dashboard?.homeworkAssigned||0],['Submitted',dashboard?.homeworkSubmitted||0],['Reviewed',dashboard?.homeworkReviewed||0],['Pending',stats.pendingReviews||0]].map(([label,value])=><p key={String(label)} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-blue-500"/><span className="text-slate-500">{label}</span><b>{String(value)}</b></p>)}</div></div>}</Panel></div>
  <div className="mt-5 grid gap-5 xl:grid-cols-2"><Panel title="Today's Classes" icon="calendar" action={<span className="text-xs text-slate-500">{prettyDate(today())}</span>}>{loading?<Loading/>:classes.length?<div className="space-y-3">{classes.map((item:Row)=><article key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3"><span className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{item.startTime||'—'}</span><div className="min-w-0 flex-1"><b className="block truncate text-sm">{item.subject||item.title||'Class'}</b><span className="text-xs text-slate-500">{item.batchName} · {item.room||'Class'}</span></div>{item.hostUrl&&<a href={item.hostUrl} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-700">Host link</a>}</article>)}<button onClick={()=>onNavigate('/teacher/timetable')} className="text-sm font-bold text-blue-700">View Full Timetable →</button></div>:<Empty title="No classes today" detail="Your scheduled classes will appear here."/>}</Panel><Panel title="My Batches" icon="briefcase">{loading?<Loading/>:batches.length?<div className="grid gap-3 sm:grid-cols-2">{batches.map((batch:Row)=><div key={batch.id} className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"><b>{batch.name}</b><p className="mt-1 text-xs text-slate-500">{batch.courseName||'Assigned batch'}</p></div>)}</div>:<Empty title="No batches assigned" detail="Your institute admin can assign batches to your profile."/>}</Panel></div>
  <Panel title={`Pending Homework Reviews (${stats.pendingReviews||0})`} icon="checklist" action={<button onClick={()=>onNavigate('/teacher/homework')} className="text-sm font-bold text-blue-700">View all →</button>}><div className="grid gap-3 sm:grid-cols-2">{reviews.map((item:Row)=><div key={item.id} className="rounded-xl border border-slate-100 p-3"><b className="text-sm">{item.title}</b><p className="text-xs text-slate-500">{item.batchName} · {item.pending||0} pending</p></div>)}</div>{!loading&&!reviews.length&&<p className="py-4 text-center text-sm font-semibold text-emerald-700">All homework reviewed!</p>}</Panel>
  <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Attendance','checklist'],['Homework','pencil'],['Exams','quiz'],['My Students','student']].map(([label,icon])=><MagneticButton key={label} onClick={()=>onNavigate(`/teacher/${String(label).toLowerCase().replace('my students','students')}`)} className="teacher-quick-action flex items-center gap-3 rounded-2xl border border-blue-100 bg-white p-4 text-left font-bold text-slate-700 shadow-sm hover:border-blue-300 hover:text-blue-700"><span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><AdminIcon name={icon} className="h-5 w-5"/></span>{label}<span className="ml-auto">→</span></MagneticButton>)}</div>
  </>; }
function Loading(){return <div className="space-y-3" aria-label="Loading"><div className="teacher-skeleton h-5 w-1/3 rounded"/><div className="teacher-skeleton h-10 rounded"/><div className="teacher-skeleton h-10 rounded"/></div>}
function Table({columns,rows,empty,loading,renderRow}:{columns:string[];rows:Row[];empty:string;loading:boolean;renderRow:(row:Row)=>ReactNode}){return <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-gradient-to-r from-blue-50 to-indigo-100 text-[11px] font-black uppercase text-blue-700"><tr>{columns.map(col=><th key={col} className="px-4 py-3">{col}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(renderRow)}</tbody></table>{loading&&<div className="p-5"><Loading/></div>}{!loading&&!rows.length&&<div className="p-5"><Empty title={empty}/></div>}</div>}
function StudentsView({data,loading,query,setQuery,onSearch}:{data:Row;loading:boolean;query:string;setQuery:(v:string)=>void;onSearch:()=>void}) { const rows=data.records||[];return <Panel title={`Students (${rows.length})`} icon="student"><form onSubmit={e=>{e.preventDefault();onSearch()}} className="mb-4 flex flex-wrap gap-2"><input className={`${inputClass} max-w-md`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or roll number..."/><button className={buttonClass}>Search</button></form><Table columns={['STUDENT','BATCH','ROLL NO.','ATTENDANCE %','STATUS','RISK']} rows={rows} loading={loading} empty="No students found in your batches." renderRow={row=><tr key={row.id}><td className="px-4 py-3 font-bold">{row.name}</td><td className="px-4 py-3">{row.batchName}</td><td className="px-4 py-3">{row.roll||'—'}</td><td className="px-4 py-3">{row.attendance}%</td><td className="px-4 py-3">{row.status}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.risk==='At risk'?'bg-rose-50 text-rose-700':'bg-emerald-50 text-emerald-700'}`}>{row.risk}</span></td></tr>}/></Panel> }
function TimetableView({data,loading}:{data:Row;loading:boolean}) { const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];const current=new Date().toLocaleDateString('en-US',{weekday:'long'});const classes:Row[]=data.classes||[];return <><Panel title="My Weekly Schedule" icon="calendar" tilt={false}>{loading?<Loading/>:<div className="overflow-x-auto"><div className="min-w-[840px]"><div className="grid grid-cols-[90px_repeat(6,minmax(110px,1fr))] border-b bg-slate-50 text-center text-xs font-black text-slate-500"><span className="p-4">TIME</span>{days.map(day=><span key={day} className={`p-4 ${day===current?'bg-blue-50 text-blue-700':''}`}>{day.slice(0,3).toUpperCase()}{day===current&&<small className="mt-1 block">TODAY</small>}</span>)}</div>{Array.from({length:12},(_,index)=>index+7).map(hour=><div key={hour} className="grid min-h-[74px] grid-cols-[90px_repeat(6,minmax(110px,1fr))] border-b last:border-0"><div className="p-3 text-xs text-slate-400">{String(hour).padStart(2,'0')}:00</div>{days.map(day=>{const matches=classes.filter(item=>item.day===day&&Number(String(item.startTime||'').slice(0,2))===hour);return <div key={day} className={`border-l border-slate-100 p-1 ${day===current?'bg-blue-50/40':''}`}>{matches.length?matches.map(item=><article key={item.id} className="rounded-lg border-l-4 border-blue-500 bg-blue-50 p-2 text-[11px]"><b className="block truncate">{item.subjectName||item.title}</b><span className="text-slate-500">{item.startTime} · {item.batchName}</span>{item.hostUrl&&<a className="block font-bold text-blue-700" href={item.hostUrl} target="_blank" rel="noreferrer">Open host link</a>}</article>):<span className="text-[10px] text-slate-300">No classes</span>}</div>})}</div>)}</div></div>}</Panel><div className="mt-5 grid gap-4 sm:grid-cols-3">{[['WEEKLY CLASSES',classes.length],['BATCHES',data.batches?.length||0],['SUBJECTS',new Set(classes.map(row=>row.subjectId).filter(Boolean)).size]].map(([label,value])=><Metric key={String(label)} label={String(label)} value={String(value)} icon="calendar"/>)}</div>{(data.holidays||[]).length>0&&<Panel title="Institute Holidays" icon="eventOff"><div className="grid gap-2 sm:grid-cols-2">{data.holidays.map((item:Row)=><p key={item.id} className="rounded-xl bg-amber-50 p-3 text-sm"><b>{item.title||item.name||'Holiday'}</b><span className="ml-2 text-slate-500">{item.startDate||item.date}</span></p>)}</div></Panel>}</> }
function AttendanceView({context,data,loading,batch,setBatch,date,setDate,attendance,setAttendance,onSave,busy}:{context:TeacherContext|null;data:Row;loading:boolean;batch:string;setBatch:(v:string)=>void;date:string;setDate:(v:string)=>void;attendance:Record<string,string>;setAttendance:(v:Record<string,string>)=>void;onSave:()=>void;busy:boolean}) { const rows:Row[]=data.records||[];return <><div className={`${panelClass} mb-5 flex flex-wrap items-center gap-3 p-4`}><select className={`${inputClass} max-w-sm`} value={batch} onChange={e=>setBatch(e.target.value)}><option value="">Select a batch</option>{context?.batches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="date" className={`${inputClass} max-w-[190px]`} value={date} onChange={e=>setDate(e.target.value)}/><button onClick={onSave} disabled={!batch||busy||loading||!rows.length} className={buttonClass}>{busy?'Saving…':'Save Attendance'}</button></div><Panel title={`Mark Attendance · ${prettyDate(date)}`} icon="checklist">{!batch?<Empty title="Select a Batch" detail="Choose one of your assigned batches to load its students."/>:loading?<Loading/>:rows.length?<><div className="mb-4 flex flex-wrap gap-2"><button onClick={()=>setAttendance(Object.fromEntries(rows.map(row=>[row.studentKey,'Present'])))} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white">✓ All Present</button><button onClick={()=>setAttendance(Object.fromEntries(rows.map(row=>[row.studentKey,'Absent'])))} className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white">× All Absent</button></div><div className="divide-y divide-slate-100">{rows.map(row=><div key={row.studentKey} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><b>{row.name}</b><p className="text-xs text-slate-500">Roll No. {row.roll||'—'}</p></div><div className="flex gap-2">{['Present','Absent','Late'].map(status=><button key={status} onClick={()=>setAttendance({...attendance,[row.studentKey]:status})} className={`rounded-lg border px-3 py-2 text-xs font-bold ${attendance[row.studentKey]===status?'border-blue-600 bg-blue-600 text-white':'border-slate-200 text-slate-600'}`}>{status}</button>)}</div></div>)}</div></>:<Empty title="No students found in this batch."/>}</Panel></> }
function HomeworkView({data,loading,onAssign,onReview}:{data:Row;loading:boolean;onAssign:()=>void;onReview:(item:Row)=>void}) { const rows:Row[]=data.records||[];return <Panel title="Homework Management" icon="pencil" action={<button onClick={onAssign} className="text-sm font-bold text-blue-700">+ Assign Homework</button>}><Table columns={['TITLE','BATCH','SUBJECT','DUE DATE','SUBMISSIONS','ACTIONS']} rows={rows} loading={loading} empty="No homework assigned yet." renderRow={row=><tr key={row.id}><td className="px-4 py-3 font-bold">{row.title}</td><td className="px-4 py-3">{row.batchName}</td><td className="px-4 py-3">{row.subject||'—'}</td><td className="px-4 py-3">{row.dueDate||'—'}</td><td className="px-4 py-3">{row.submissions} · {row.pending} pending</td><td className="px-4 py-3"><button onClick={()=>onReview(row)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700">Review</button></td></tr>}/></Panel> }
function ExamsView({data,loading,onCreate}:{data:Row;loading:boolean;onCreate:()=>void}) { const rows:Row[]=data.records||[];return <Panel title="My Exams — Exams you have created" icon="quiz" action={<button className="text-sm font-bold text-blue-700" onClick={onCreate}>+ Create Exam</button>}><Table columns={['EXAM','BATCH','SCHEDULED','MARKS','SUBMISSIONS','STATUS','ACTIONS']} rows={rows} loading={loading} empty="No exams created yet. Create your first exam." renderRow={row=><tr key={row.id}><td className="px-4 py-3 font-bold">{row.title||row.name}</td><td className="px-4 py-3">{row.batchName||row.batchId}</td><td className="px-4 py-3">{row.scheduledAt?new Date(row.scheduledAt).toLocaleString():'—'}</td><td className="px-4 py-3">{row.totalMarks||row.maxMarks||'—'}</td><td className="px-4 py-3">{row.submissions||0}</td><td className="px-4 py-3">{row.status||'Scheduled'}</td><td className="px-4 py-3">—</td></tr>}/></Panel> }
function ResultsView({data,loading}:{data:Row;loading:boolean}) { const rows:Row[]=data.records||[];return <Panel title="Student Results — Results from exams in your batches" icon="report"><Table columns={['STUDENT','EXAM','SUBJECT','SCORE','GRADE','DATE']} rows={rows} loading={loading} empty="No results found." renderRow={row=><tr key={row.id}><td className="px-4 py-3 font-bold">{row.studentName||row.student||'—'}</td><td className="px-4 py-3">{row.examName||row.exam||row.title||'—'}</td><td className="px-4 py-3">{row.subjectName||row.subject||'—'}</td><td className="px-4 py-3">{row.score??row.marks??'—'}</td><td className="px-4 py-3">{row.grade||'—'}</td><td className="px-4 py-3">{row.date||row.createdAt?.slice(0,10)||'—'}</td></tr>}/></Panel> }
function FilesView({data,loading,onDownload,onDelete}:{data:Row;loading:boolean;onDownload:(row:Row)=>void;onDelete:(row:Row)=>void}) { const rows:Row[]=data.records||[];return <Panel title="Shared Files" icon="download"><Table columns={['FILE','BATCH','SUBJECT','UPLOADED','ACTIONS']} rows={rows} loading={loading} empty="No shared files yet. Upload a resource for one of your batches." renderRow={row=><tr key={row.id}><td className="px-4 py-3"><b>{row.title}</b><p className="text-xs text-slate-500">{row.fileName}</p></td><td className="px-4 py-3">{row.batchName}</td><td className="px-4 py-3">{row.subjectName||row.subjectId||'—'}</td><td className="px-4 py-3">{row.createdAt?.slice(0,10)||'—'}</td><td className="px-4 py-3"><div className="flex gap-2"><button onClick={()=>onDownload(row)} className="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700">Download</button><button onClick={()=>onDelete(row)} className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-700">Delete</button></div></td></tr>}/></Panel> }
function ProfileView({profile,busy,onSave,onPassword}:{profile:Row;busy:boolean;onSave:(value:Row)=>void;onPassword:(value:Row)=>void}) { const [subjects,setSubjects]=useState<string[]>(profile.subjects||[]),[subject,setSubject]=useState('');useEffect(()=>setSubjects(profile.subjects||[]),[profile.subjects]);return <div className="grid gap-5 xl:grid-cols-[.8fr_1.5fr]"><Panel title="My Profile" icon="person"><div className="text-center"><div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-blue-600 text-2xl font-black text-white">{String(profile.name||'T').slice(0,1).toUpperCase()}</div><h3 className="mt-3 text-lg font-black">{profile.name||'Teacher'}</h3><p className="text-sm text-slate-500">{profile.specialization||'Teacher'} · {profile.qualification||'Qualification not set'}</p></div><dl className="mt-5 divide-y divide-slate-100 text-sm">{[['Years Exp.',profile.experience||0],['Subjects',subjects.length],['Employee ID',profile.employeeId||'—']].map(([label,value])=><div key={String(label)} className="flex justify-between py-3"><dt className="text-slate-500">{label}</dt><dd className="font-bold">{String(value)}</dd></div>)}</dl></Panel><div className="space-y-5"><Panel title="Profile Information"><form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave({name:f.get('name'),phone:f.get('phone'),qualification:f.get('qualification'),specialization:f.get('specialization'),experience:f.get('experience'),bio:f.get('bio'),subjects});}}>{[['name','FULL NAME*',profile.name,'text'],['phone','PHONE',profile.phone,'tel'],['qualification','QUALIFICATION',profile.qualification,'text'],['specialization','SPECIALIZATION',profile.specialization,'text'],['experience','EXPERIENCE (YEARS)',profile.experience||0,'number']].map(([name,label,value,type])=><label key={String(name)} className="text-xs font-black text-slate-600">{label}<input name={String(name)} type={String(type)} defaultValue={String(value||'')} required={name==='name'} className={`${inputClass} mt-1.5 normal-case font-normal`}/></label>)}<label className="text-xs font-black text-slate-600">EMPLOYEE ID (READ-ONLY)<input readOnly value={profile.employeeId||''} className={`${inputClass} mt-1.5 bg-slate-50 normal-case font-normal`}/></label><div className="sm:col-span-2"><label className="text-xs font-black text-slate-600">SUBJECTS TAUGHT</label><div className="mt-1.5 flex gap-2"><input value={subject} onChange={e=>setSubject(e.target.value)} className={inputClass} placeholder="Add a subject"/><button type="button" className="rounded-xl border border-blue-200 px-4 text-sm font-bold text-blue-700" onClick={()=>{if(subject.trim()){setSubjects([...subjects,subject.trim()]);setSubject('');}}}>Add</button></div><div className="mt-2 flex flex-wrap gap-2">{subjects.map((item,index)=><button type="button" key={`${item}-${index}`} onClick={()=>setSubjects(subjects.filter((_,i)=>i!==index))} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{item} ×</button>)}</div><p className="mt-1 text-xs text-slate-400">These subjects will appear in the timetable scheduler.</p></div><label className="text-xs font-black text-slate-600 sm:col-span-2">BIO / ABOUT<textarea name="bio" defaultValue={profile.bio||''} className={`${inputClass} mt-1.5 min-h-24 normal-case font-normal`}/></label><div className="sm:col-span-2"><button className={buttonClass} disabled={busy}>{busy?'Saving…':'Save Changes'}</button></div></form></Panel><PasswordForm busy={busy} onSubmit={onPassword}/></div></div> }
function PasswordForm({busy,onSubmit}:{busy:boolean;onSubmit:(v:Row)=>void}) { return <Panel title="Change Password" icon="shield"><form className="grid gap-3 sm:grid-cols-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),password=String(f.get('password')||''),confirmPassword=String(f.get('confirmPassword')||'');if(password!==confirmPassword){alert('Passwords do not match.');return;}onSubmit({password,confirmPassword});}}>{[['currentPassword','Current password'],['password','New password'],['confirmPassword','Confirm password']].map(([name,label])=><label key={name} className="text-xs font-bold">{label}<input name={name} type="password" required minLength={8} className={`${inputClass} mt-1.5`}/></label>)}<button className={`${buttonClass} sm:col-span-3`} disabled={busy}>Update Password</button></form></Panel> }
function LeaveView({data,loading,busy,onApply}:{data:Row;loading:boolean;busy:boolean;onApply:(value:Row)=>void}) { return <div className="grid gap-5 xl:grid-cols-[1.5fr_.8fr]"><Panel title="Leave History" icon="eventOff">{loading?<Loading/>:(data.records||[]).length?<div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="bg-blue-50 text-left text-xs font-black uppercase"><tr>{['TYPE','DATES','DAYS','REASON','STATUS'].map(item=><th key={item} className="px-3 py-3">{item}</th>)}</tr></thead><tbody className="divide-y">{data.records.map((row:Row)=><tr key={row.id}><td className="px-3 py-3">{row.leaveType}</td><td className="px-3 py-3">{row.startDate} – {row.endDate}</td><td className="px-3 py-3">{Math.ceil((new Date(row.endDate).getTime()-new Date(row.startDate).getTime())/86400000)+1}</td><td className="px-3 py-3">{row.reason}</td><td className="px-3 py-3">{row.status}</td></tr>)}</tbody></table></div>:<Empty title="No leave requests found"/>}</Panel><div className="space-y-5"><Panel title="Apply for Leave" icon="event"><form className="grid gap-3" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onApply({leaveType:f.get('leaveType'),startDate:f.get('startDate'),endDate:f.get('endDate'),reason:f.get('reason')});}}><label className="text-xs font-bold">Leave type<select name="leaveType" className={`${inputClass} mt-1`}><option>Casual</option><option>Sick</option><option>Annual</option><option>Other</option></select></label><label className="text-xs font-bold">From<input name="startDate" required type="date" className={`${inputClass} mt-1`}/></label><label className="text-xs font-bold">To<input name="endDate" required type="date" className={`${inputClass} mt-1`}/></label><label className="text-xs font-bold">Reason<textarea name="reason" required maxLength={1000} className={`${inputClass} mt-1 min-h-20`}/></label><button className={buttonClass} disabled={busy}>Submit Request</button></form></Panel><Panel title="Holiday Calendar" icon="calendar">{(data.holidays||[]).length?<div className="space-y-2">{data.holidays.map((row:Row)=><div key={row.id} className="rounded-xl bg-amber-50 p-3"><b className="text-sm">{row.title||row.name}</b><p className="text-xs text-slate-500">{row.startDate||row.date}{row.endDate?` – ${row.endDate}`:''}</p></div>)}</div>:<p className="py-4 text-center text-sm text-slate-500">No holidays added</p>}</Panel></div></div> }
function PayslipView({data,loading,onDownload}:{data:Row;loading:boolean;onDownload:(item:Row)=>void}) {
  const rows: Row[] = data.records || [];
  const stats = data.stats || {};
  const paymentDetails = data.paymentDetails || {};
  const [calcItem, setCalcItem] = useState<Row | null>(null);
  const [receiptItem, setReceiptItem] = useState<Row | null>(null);

  return (
    <>
      <p className="mb-5 text-sm text-slate-600">
        Review your monthly salary disbursements, detailed calculation breakdowns, and official payment receipts.
      </p>

      {/* Stats Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Metric label="PAYMENTS RECEIVED" value={stats.available || 0} icon="document" />
        <Metric label="PAID THIS YEAR" value={stats.thisYear || 0} icon="calendar" color="green" />
        <Metric label="LIFETIME EARNED" value={money(stats.lifetimeEarned || 0)} icon="rupee" color="amber" />
      </div>

      {/* Saved Payout Details */}
      {(paymentDetails.bankName || paymentDetails.accountMasked || paymentDetails.upiId) && (
        <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50/40 p-4 text-xs text-slate-700 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-2 mb-3">
            <span className="font-extrabold uppercase tracking-wide text-orange-800 flex items-center gap-1.5">
              <AdminIcon name="payment" className="h-4 w-4 text-orange-600" />
              My Saved Payout Details (Confidential)
            </span>
            <span className="rounded-full bg-white px-2.5 py-0.5 font-bold text-slate-600 border border-orange-100">
              Mode: {paymentDetails.paymentMode === 'both' ? 'Bank Transfer / UPI' : paymentDetails.paymentMode?.toUpperCase()}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <span className="text-slate-400 block font-semibold">Account Holder</span>
              <strong className="text-slate-900">{paymentDetails.accountHolderName || '—'}</strong>
            </div>
            <div>
              <span className="text-slate-400 block font-semibold">Bank & Branch</span>
              <strong className="text-slate-900">{paymentDetails.bankName || '—'} {paymentDetails.branch ? `(${paymentDetails.branch})` : ''}</strong>
            </div>
            <div>
              <span className="text-slate-400 block font-semibold">Account Number</span>
              <strong className="font-mono text-slate-900">{paymentDetails.accountMasked || '—'}</strong>
            </div>
            <div>
              <span className="text-slate-400 block font-semibold">UPI ID / VPA</span>
              <strong className="font-mono text-orange-700">{paymentDetails.upiId || '—'}</strong>
            </div>
          </div>
        </div>
      )}

      {/* Salary History Table */}
      <div className="mt-5">
        <Panel title="My Salary History" icon="payment">
          <Table
            columns={['PERIOD', 'NET PAY', 'STATUS', 'PAID DATE', 'METHOD', 'ACTIONS']}
            rows={rows}
            loading={loading}
            empty="No salary records yet — Your salary records will appear here once payroll is processed by institute administration."
            renderRow={row => {
              const isPaid = row.isPaid || row.status === 'Paid';
              const periodName = new Date(`${String(row.periodStart).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
              return (
                <tr key={row.id} className="hover:bg-slate-50/60 transition">
                  <td className="px-4 py-3 font-extrabold text-slate-900">{periodName}</td>
                  <td className="px-4 py-3 font-black text-emerald-700 text-sm">{money(row.netPay)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${
                      isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {isPaid ? 'Paid' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 font-medium">
                    {row.paidAt ? new Date(`${String(row.paidAt).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                    {row.paymentMethod || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCalcItem(row)}
                        className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-bold text-orange-700 hover:bg-orange-100 transition"
                      >
                        <AdminIcon name="calculator" className="h-3.5 w-3.5" />
                        Calculation
                      </button>

                      {isPaid ? (
                        <button
                          type="button"
                          onClick={() => setReceiptItem(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800 hover:bg-emerald-100 transition shadow-sm"
                        >
                          <AdminIcon name="document" className="h-3.5 w-3.5 text-emerald-700" />
                          Receipt
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Not paid yet</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }}
          />
        </Panel>
      </div>

      {/* Teacher View Calculation Modal */}
      {calcItem && (
        <TeacherDialog title={`Salary Calculation — ${new Date(`${String(calcItem.periodStart).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`} close={() => setCalcItem(null)}>
          <div className="space-y-4 text-xs text-slate-800">
            {/* Work & Attendance Summary */}
            <div className="grid gap-3 sm:grid-cols-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <span className="text-slate-500 block font-semibold">Attendance</span>
                <strong className="text-sm text-slate-900">{calcItem.attendanceDays || 0} Present Days</strong>
              </div>
              <div>
                <span className="text-slate-500 block font-semibold">Approved Teaching</span>
                <strong className="text-sm text-slate-900">{Number(calcItem.payableHours || 0).toFixed(2)} Hours</strong>
              </div>
              <div>
                <span className="text-slate-500 block font-semibold">Status</span>
                <strong className={`text-sm ${calcItem.isPaid ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {calcItem.isPaid ? 'Paid & Settled' : 'Pending Settlement'}
                </strong>
              </div>
            </div>

            {/* Breakdown Table */}
            <div className="overflow-hidden rounded-xl border border-orange-200">
              <table className="w-full text-left">
                <thead className="bg-orange-500 text-white font-black uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-2.5">Earnings Particulars</th>
                    <th className="p-2.5 text-right">Amount</th>
                    <th className="p-2.5">Deductions</th>
                    <th className="p-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-orange-100">
                  <tr>
                    <td className="p-2.5 font-bold">Base / Monthly Component</td>
                    <td className="p-2.5 text-right font-bold">{money(calcItem.breakdown?.baseSalary || calcItem.grossPay || 0)}</td>
                    <td className="p-2.5 font-bold">Provident Fund (PF)</td>
                    <td className="p-2.5 text-right font-bold text-rose-700">{money(calcItem.breakdown?.pfDeduction || 0)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">Teaching / Hourly Earnings</td>
                    <td className="p-2.5 text-right font-bold">{money(calcItem.breakdown?.teachingEarnings || 0)}</td>
                    <td className="p-2.5 font-bold">Tax Deducted at Source (TDS)</td>
                    <td className="p-2.5 text-right font-bold text-rose-700">{money(calcItem.breakdown?.tdsDeduction || 0)}</td>
                  </tr>
                  <tr>
                    <td className="p-2.5 font-bold">Allowances & Other Earnings</td>
                    <td className="p-2.5 text-right font-bold">{money(calcItem.breakdown?.allowances || 0)}</td>
                    <td className="p-2.5 font-bold">Advance Repayment / Other</td>
                    <td className="p-2.5 text-right font-bold text-rose-700">{money((calcItem.breakdown?.advanceRecovery || 0) + (calcItem.breakdown?.otherDeductions || 0))}</td>
                  </tr>
                  <tr className="bg-orange-50/60 font-black">
                    <td className="p-2.5 uppercase">Gross Total</td>
                    <td className="p-2.5 text-right text-slate-900">{money(calcItem.grossPay)}</td>
                    <td className="p-2.5 uppercase text-rose-800">Total Deductions</td>
                    <td className="p-2.5 text-right text-rose-800">{money(calcItem.deductions)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Net Amount Banner */}
            <div className="rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 p-4 text-white flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase text-orange-100">Net Payable Amount</span>
                <div className="text-2xl font-black">{money(calcItem.netPay)}</div>
              </div>
              <button
                type="button"
                onClick={() => setCalcItem(null)}
                className="rounded-xl bg-white text-orange-600 px-4 py-2 font-bold text-xs hover:bg-orange-50 transition"
              >
                Close
              </button>
            </div>
          </div>
        </TeacherDialog>
      )}

      {/* Teacher View Receipt Modal */}
      {receiptItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-3xl my-8 rounded-3xl bg-white shadow-2xl overflow-hidden text-slate-800 border border-orange-200">
            {/* Action Bar */}
            <div className="flex items-center justify-between bg-gradient-to-r from-orange-600 to-orange-500 px-6 py-4 text-white print:hidden">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setReceiptItem(null)}
                  className="rounded-xl bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-black transition"
                >
                  ← Close
                </button>
                <span className="font-extrabold text-sm sm:text-base">Salary Payment Receipt</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white text-orange-600 hover:bg-orange-50 px-3.5 py-1.5 text-xs font-black shadow-md transition"
                >
                  <AdminIcon name="print" className="h-4 w-4" />
                  Print / Save PDF
                </button>
                <button
                  type="button"
                  onClick={() => onDownload(receiptItem)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white px-3.5 py-1.5 text-xs font-black transition"
                >
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptItem(null)}
                  className="rounded-xl p-1.5 hover:bg-white/20 transition text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Receipt Content */}
            <div id="salary-receipt-view" className="p-8 space-y-6 bg-white print:p-6 print:border-none">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-orange-500 pb-5">
                <div>
                  <div className="inline-block rounded-xl bg-white p-2 border border-orange-100 shadow-sm">
                    <img src="/mainlogo.png" alt="My JEE Mentor" className="h-10 w-auto object-contain" />
                  </div>
                  <p className="mt-2 text-xs font-bold text-slate-600">
                    amyjeementor@gmail.com | 7294048814
                  </p>
                  <p className="text-[11px] text-slate-400">
                    My JEE Mentor • Advanced Learning & Test Preparation Institute
                  </p>
                </div>
                <div className="text-right">
                  <span className="inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-800 mb-1">
                    ✓ Fully Paid
                  </span>
                  <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 uppercase">
                    Salary Payment Receipt
                  </h1>
                  <div className="mt-1 text-xs text-slate-600">
                    <span>Receipt No: </span>
                    <strong className="font-mono text-orange-600 font-bold">
                      {receiptItem.receiptNo || receiptItem.payment?.receiptNo || `MJM-SAL-${new Date().getFullYear()}-001`}
                    </strong>
                  </div>
                  <div className="text-xs text-slate-500">
                    <span>Payment Date: </span>
                    <strong className="font-medium text-slate-700">
                      {receiptItem.paidAt ? new Date(`${String(receiptItem.paidAt).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Staff & Payment Details Grid */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4 text-xs">
                  <h3 className="font-black uppercase tracking-wider text-orange-800 mb-3 flex items-center gap-1.5">
                    <AdminIcon name="person" className="h-4 w-4 text-orange-600" />
                    Staff Information
                  </h3>
                  <div className="space-y-1.5">
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Staff Name:</span>
                      <span className="font-bold text-slate-900">{paymentDetails.accountHolderName || 'Teacher'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Period:</span>
                      <span className="font-extrabold text-orange-700">
                        {new Date(`${String(receiptItem.periodStart).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-slate-500">Status:</span>
                      <span className="font-bold text-emerald-700">Paid & Settled</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4 text-xs">
                  <h3 className="font-black uppercase tracking-wider text-orange-800 mb-3 flex items-center gap-1.5">
                    <AdminIcon name="payment" className="h-4 w-4 text-orange-600" />
                    Payment Details
                  </h3>
                  <div className="space-y-1.5">
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Method:</span>
                      <span className="font-extrabold text-emerald-800">{receiptItem.paymentMethod || receiptItem.payment?.paymentMethod || 'Bank Transfer'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Transaction ID (UTR):</span>
                      <span className="font-mono font-bold text-slate-900">{receiptItem.payment?.transactionId || '—'}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-slate-500">Account / VPA:</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {receiptItem.payment?.upiId || receiptItem.payment?.accountMasked || paymentDetails.upiId || paymentDetails.accountMasked || '—'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Breakdown Table */}
              <div className="overflow-hidden rounded-2xl border border-orange-200 text-xs">
                <table className="w-full text-left">
                  <thead className="bg-orange-500 text-white font-black uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3">Earnings Particulars</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                      <th className="p-3">Deductions</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100">
                    <tr>
                      <td className="p-3 font-bold text-slate-800">Base Compensation</td>
                      <td className="p-3 text-right font-bold text-slate-800">{money(receiptItem.grossPay)}</td>
                      <td className="p-3 font-bold text-slate-800">Total Deductions</td>
                      <td className="p-3 text-right font-bold text-rose-700">{money(receiptItem.deductions)}</td>
                    </tr>
                    <tr className="bg-orange-50/60 font-black">
                      <td className="p-3 uppercase text-slate-900">Gross Total</td>
                      <td className="p-3 text-right text-slate-900">{money(receiptItem.grossPay)}</td>
                      <td className="p-3 uppercase text-rose-800">Total Deductions</td>
                      <td className="p-3 text-right text-rose-800">{money(receiptItem.deductions)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Net Banner */}
              <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-5 text-white flex flex-wrap items-center justify-between gap-4 shadow-md">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-100">Net Salary Paid</span>
                  <h2 className="text-2xl sm:text-3xl font-black mt-0.5 tracking-tight">{money(receiptItem.netPay)}</h2>
                </div>
                <div className="flex items-center gap-2 rounded-2xl bg-white/20 backdrop-blur-sm px-4 py-2 text-white border border-white/30">
                  <AdminIcon name="check" className="h-6 w-6 text-emerald-300" />
                  <div className="text-left">
                    <div className="text-xs font-black uppercase tracking-wider">Settlement Confirmed</div>
                    <div className="text-[10px] text-orange-100">Disbursed on {receiptItem.paidAt ? String(receiptItem.paidAt).slice(0, 10) : '—'}</div>
                  </div>
                </div>
              </div>

              {/* Signatures */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
                <div>
                  <div className="border-b border-slate-300 pb-12 font-bold text-slate-400">
                    {paymentDetails.accountHolderName || 'Staff Member'}
                  </div>
                  <p className="mt-2 font-bold text-slate-700">Staff / Employee Signature</p>
                </div>
                <div>
                  <div className="border-b border-slate-300 pb-12 flex items-end justify-center">
                    <span className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1 font-mono text-[10px] font-black text-orange-800 uppercase tracking-widest">
                      My JEE Mentor • Official Seal
                    </span>
                  </div>
                  <p className="mt-2 font-bold text-slate-700">Authorised Signatory</p>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3 text-center text-[10px] text-slate-400">
                This is a computer-generated salary payment receipt from My JEE Mentor. No physical signature is required.
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function TeacherDialog({title,close,children}:{title:string;close:()=>void;children:ReactNode}) { const [closing,setClosing]=useState(false);const timer=useRef<number|null>(null);useEffect(()=>()=>{if(timer.current!==null)window.clearTimeout(timer.current);},[]);const requestClose=()=>{setClosing(true);timer.current=window.setTimeout(close,160);};return <div className={`teacher-dialog fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 ${closing?'teacher-dialog-closing':''}`} role="dialog" aria-modal="true"><section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between bg-blue-700 px-5 py-4 text-white"><h2 className="text-lg font-black">{title}</h2><button onClick={requestClose} aria-label="Close" className="text-2xl leading-none">×</button></header><div className="p-5">{children}</div></section></div> }
function LookupSelect({name,label,items,required=true}:{name:string;label:string;items:Array<{id:string;name:string}>;required?:boolean}) { return <label className="text-xs font-black text-slate-600">{label}<select name={name} required={required} className={`${inputClass} mt-1.5 normal-case font-normal`}><option value="">Select…</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label> }
function HomeworkForm({context,busy,onSubmit}:{context:TeacherContext|null;busy:boolean;onSubmit:(value:Row)=>void}) { const [batch,setBatch]=useState('');return <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSubmit({title:f.get('title'),batchId:f.get('batchId'),subjectId:f.get('subjectId'),type:f.get('type'),maxMarks:f.get('maxMarks'),dueDate:f.get('dueDate'),description:f.get('description'),allowLate:f.get('allowLate')==='on'});}}><label className="text-xs font-black text-slate-600 sm:col-span-2">TITLE*<input name="title" required maxLength={180} className={`${inputClass} mt-1.5`}/></label><label className="text-xs font-black text-slate-600">BATCH*<select name="batchId" required value={batch} onChange={e=>setBatch(e.target.value)} className={`${inputClass} mt-1.5`}><option value="">Select batch</option>{context?.batches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-black text-slate-600">SUBJECT*<select name="subjectId" required className={`${inputClass} mt-1.5`}><option value="">Select subject</option>{context?.subjects.filter(item=>!item.batchId||item.batchId===batch).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-black text-slate-600">TYPE<select name="type" className={`${inputClass} mt-1.5`}><option>Homework</option><option>Assignment</option><option>Practice</option></select></label><label className="text-xs font-black text-slate-600">MAX MARKS<input name="maxMarks" type="number" min="1" defaultValue="10" className={`${inputClass} mt-1.5`}/></label><label className="text-xs font-black text-slate-600">DUE DATE<input name="dueDate" type="date" required className={`${inputClass} mt-1.5`}/></label><label className="flex items-center gap-2 self-end text-sm"><input name="allowLate" type="checkbox" className="accent-blue-600"/>Allow late submissions</label><label className="text-xs font-black text-slate-600 sm:col-span-2">DESCRIPTION<textarea name="description" className={`${inputClass} mt-1.5 min-h-20`}/></label><div className="flex justify-end sm:col-span-2"><button disabled={busy||!context?.batches.length} className={buttonClass}>{busy?'Assigning…':'Assign'}</button></div></form> }
function ExamForm({context,busy,onSubmit}:{context:TeacherContext|null;busy:boolean;onSubmit:(value:Row)=>void}) { const [batch,setBatch]=useState('');return <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSubmit({title:f.get('title'),batchId:f.get('batchId'),subjectId:f.get('subjectId'),scheduledAt:new Date(String(f.get('scheduledAt'))).toISOString(),totalMarks:f.get('totalMarks')});}}><label className="text-xs font-black sm:col-span-2">EXAM TITLE*<input name="title" required className={`${inputClass} mt-1.5`}/></label><label className="text-xs font-black">BATCH*<select name="batchId" required value={batch} onChange={e=>setBatch(e.target.value)} className={`${inputClass} mt-1.5`}><option value="">Select batch</option>{context?.batches.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-black">SUBJECT*<select name="subjectId" required className={`${inputClass} mt-1.5`}><option value="">Select subject</option>{context?.subjects.filter(item=>!item.batchId||item.batchId===batch).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-black">SCHEDULED<input name="scheduledAt" required type="datetime-local" className={`${inputClass} mt-1.5`}/></label><label className="text-xs font-black">TOTAL MARKS<input name="totalMarks" type="number" min="1" defaultValue="100" className={`${inputClass} mt-1.5`}/></label><div className="flex justify-end sm:col-span-2"><button disabled={busy||!context?.batches.length} className={buttonClass}>{busy?'Creating…':'Create Exam'}</button></div></form> }
function FileForm({context,busy,onSubmit}:{context:TeacherContext|null;busy:boolean;onSubmit:(value:{file:File;fields:Record<string,string>})=>void}) { return <form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('file');if(!(file instanceof File)||!file.size)return;onSubmit({file,fields:{title:String(f.get('title')||''),batchId:String(f.get('batchId')||''),subjectId:String(f.get('subjectId')||''),description:String(f.get('description')||'')}});}}><label className="text-xs font-black sm:col-span-2">TITLE*<input name="title" required maxLength={180} className={`${inputClass} mt-1.5`}/></label><LookupSelect name="batchId" label="BATCH*" items={context?.batches||[]}/><label className="text-xs font-black">SUBJECT<select name="subjectId" className={`${inputClass} mt-1.5`}><option value="">All subjects</option>{context?.subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-black sm:col-span-2">FILE (PDF OR IMAGE, UP TO 50 MB)*<input name="file" required type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className={`${inputClass} mt-1.5`}/></label><label className="text-xs font-black sm:col-span-2">DESCRIPTION<textarea name="description" maxLength={1000} className={`${inputClass} mt-1.5`}/></label><div className="flex justify-end sm:col-span-2"><button disabled={busy||!context?.batches.length} className={buttonClass}>{busy?'Uploading…':'Upload File'}</button></div></form> }
function SubmissionReview({data,busy,onReview}:{data:Row;busy:boolean;onReview:(row:Row,value:Row)=>void}) { const rows:Row[]=data.records||[];return <div className="space-y-3">{rows.length?rows.map(row=><SubmissionRow key={row.id} row={row} busy={busy} onReview={value=>onReview(row,value)}/>):<Empty title="No submissions yet."/>}</div> }
function SubmissionRow({row,busy,onReview}:{row:Row;busy:boolean;onReview:(value:Row)=>void}) { const [score,setScore]=useState(String(row.score||'')),[feedback,setFeedback]=useState(row.feedback||'');return <form onSubmit={e=>{e.preventDefault();onReview({score:Number(score),feedback});}} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><b>{row.studentName||'Student'} · {row.roll||'—'}</b><span className="text-xs font-bold text-blue-700">{row.status}</span></div><p className="mt-1 text-sm text-slate-600">{row.answer||row.response||row.content||'Submission received.'}</p><div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_auto]"><input aria-label="Score" type="number" min="0" value={score} onChange={e=>setScore(e.target.value)} className={inputClass} placeholder="Score"/><input aria-label="Feedback" value={feedback} onChange={e=>setFeedback(e.target.value)} className={inputClass} placeholder="Feedback"/><button className={buttonClass} disabled={busy}>Save review</button></div></form> }
