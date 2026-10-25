import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { useLocation, useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import { AnimatedCount, MagneticButton, TiltCard } from './TeacherEffects';
import lightLogo from '../assets/mainlogo.png';
import { apiRequest } from '../services/api';
import { currentAccount, logout } from '../services/auth';
import { getStudentPortal, joinLiveClass, type StudentPortalData, type StudentPortalProfile } from '../services/studentPortal';
import { markStudentNoticesRead, studentAttendanceState, summarizeStudentFees } from './StudentPanelModel';
import StudentPageHead from './StudentPageHead';
import { applyStudentTheme, getInitialStudentTheme, type StudentThemeMode } from './StudentTheme';
import './StudentPage.css';

type Row = Record<string, any>;
type PageKey = 'dashboard'|'timetable'|'attendance'|'exams'|'results'|'homework'|'downloads'|'fees'|'id-card'|'certificates'|'messages'|'notifications'|'tutor'|'live-classes'|'videos'|'doubts'|'profile';
type NavItem = { label: string; path: string; icon: string; key: PageKey };
const groups: Array<{ name: string; items: NavItem[] }> = [
  { name: 'OVERVIEW', items: [{ label: 'Dashboard', path: '/student/dashboard', icon: 'dashboard', key: 'dashboard' }, { label: 'Timetable', path: '/student/timetable', icon: 'calendar', key: 'timetable' }, { label: 'Attendance', path: '/student/attendance', icon: 'checklist', key: 'attendance' }] },
  { name: 'ACADEMICS', items: [{ label: 'Exams', path: '/student/exams', icon: 'quiz', key: 'exams' }, { label: 'Results', path: '/student/results', icon: 'report', key: 'results' }, { label: 'Homework', path: '/student/homework', icon: 'pencil', key: 'homework' }, { label: 'Download Center', path: '/student/downloads', icon: 'download', key: 'downloads' }] },
  { name: 'FINANCE', items: [{ label: 'My Fees', path: '/student/fees', icon: 'rupee', key: 'fees' }] },
  { name: 'DOCUMENTS', items: [{ label: 'ID Card', path: '/student/id-card', icon: 'student', key: 'id-card' }, { label: 'Certificates', path: '/student/certificates', icon: 'verified', key: 'certificates' }] },
  { name: 'COMMUNICATION', items: [{ label: 'Messages', path: '/student/messages', icon: 'chat', key: 'messages' }, { label: 'Notifications', path: '/student/notifications', icon: 'bell', key: 'notifications' }] },
  { name: 'ACCOUNT', items: [{ label: 'AI Tutor', path: '/student/tutor', icon: 'chip', key: 'tutor' }, { label: 'My Profile', path: '/student/profile', icon: 'person', key: 'profile' }] },
];
const quickLinks: NavItem[] = [groups[1].items[0],groups[1].items[1],groups[0].items[2],groups[1].items[2],groups[2].items[0],groups[1].items[3],groups[0].items[1],{ label:'Videos',path:'/student/videos',icon:'play',key:'videos' },{ label:'Live Classes',path:'/student/live-classes',icon:'video',key:'live-classes' },{ label:'My Doubts',path:'/student/doubts',icon:'chat',key:'doubts' },groups[4].items[1],groups[5].items[0]];
const pageTitles: Record<PageKey, string> = { dashboard:'Dashboard', timetable:'My Timetable', attendance:'My Attendance', exams:'My Exams', results:'My Results', homework:'Homework', downloads:'Download Center', fees:'My Fees', 'id-card':'Student ID Card', certificates:'Certificates', messages:'Messages', notifications:'Notifications', tutor:'AI Tutor', 'live-classes':'Live Classes', videos:'Video Lectures', doubts:'My Doubts', profile:'My Profile' };
const pageDescriptions: Record<PageKey, string> = { dashboard:'Your classes, attendance and learning progress.', timetable:'Your weekly class schedule.', attendance:'Review your attendance history.', exams:'Upcoming and completed exams for your batch.', results:'Published results and subject performance.', homework:'Assignments shared with your batch.', downloads:'Study materials and files shared by your institute.', fees:'Your fee installments and payment status.', 'id-card':'View and print your student identity card.', certificates:'Your available student documents.', messages:'Contact teachers and institute staff.', notifications:'Meeting notices and updates for your student account.', tutor:'Study help and your submitted questions.', 'live-classes':'Scheduled online classes for your batch.', videos:'Recorded lessons shared with your batch.', doubts:'Questions you have shared with your teachers.', profile:'Your personal and academic information.' };
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';
const panel = 'student-card overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm';
const input = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm outline-none transition';
const formatDate = (value?: string) => value ? new Date(`${String(value).slice(0,10)}T00:00:00`).toLocaleDateString('en-IN',{ day:'2-digit',month:'short',year:'numeric' }) : '—';
const formatMoney = (value: number) => `₹${Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`;
const currentMonth = () => new Date().toISOString().slice(0,7);
const initials = (name: string) => name.trim().split(/\s+/).slice(0,2).map(part=>part[0]||'').join('').toUpperCase() || 'ST';
const safeStorage = (key: string, value?: string) => { try { if (value === undefined) return window.localStorage.getItem(key); window.localStorage.setItem(key,value); } catch { return null; } return null; };
function pageFromPath(path: string): PageKey { const slug = path.replace(/^\/student\/?/,'').split('/')[0] || 'dashboard'; return (slug === 'resources' ? 'downloads' : slug === 'fees-payments' ? 'fees' : slug) in pageTitles ? (slug === 'resources' ? 'downloads' : slug === 'fees-payments' ? 'fees' : slug) as PageKey : 'dashboard'; }
function getArray(value: unknown): Row[] { return Array.isArray(value) ? value : []; }

export default function StudentPage() { return <HelmetProvider><StudentWorkspace /></HelmetProvider>; }

function StudentWorkspace() {
  const location = useLocation(); const navigate = useNavigate(); const page = pageFromPath(location.pathname);
  const [profile,setProfile] = useState<StudentPortalProfile|null>(null); const [data,setData] = useState<StudentPortalData|null>(null);
  const [account,setAccount] = useState<Row|null>(null); const [loading,setLoading] = useState(true); const [error,setError] = useState('');
  const [theme,setTheme] = useState<StudentThemeMode>(getInitialStudentTheme); const [drawer,setDrawer] = useState(false); const [menuSearch,setMenuSearch] = useState('');
  const [collapsed,setCollapsed] = useState<Record<string,boolean>>(()=>{ try{return JSON.parse(window.localStorage.getItem('student-nav-collapsed')||'{}') as Record<string,boolean>}catch{return {}} });
  const [search,setSearch] = useState(''); const [appliedSearch,setAppliedSearch] = useState(''); const [month,setMonth] = useState(currentMonth); const [notices,setNotices] = useState<Row[]>([]); const [doubts,setDoubts] = useState<Row[]>([]);
  const [sidebarCollapsed,setSidebarCollapsed] = useState(()=>safeStorage('student-sidebar-collapsed')==='true');
  const [localRead,setLocalRead] = useState<string[]>(()=>{try{return JSON.parse(window.localStorage.getItem('student-read-notices')||'[]') as string[]}catch{return []}});
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(''); const [accountError,setAccountError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string; sub?: string } | null>(null);
  const [busyJoinId, setBusyJoinId] = useState<string | null>(null);

  const showToast = (type: 'success' | 'error', message: string, sub?: string) => {
    setToast({ type, message, sub });
    setTimeout(() => setToast(null), 3500);
  };

  const handleJoinClass = async (classItem: Row) => {
    setBusyJoinId(String(classItem.id));
    try {
      const res = await joinLiveClass(String(classItem.id));
      showToast('success', res.message || 'Attendance marked ✓', `${res.subjectName || ''} • ${res.date || ''} ${res.time || ''}`);
      if (res.meetingUrl) {
        setTimeout(() => {
          window.open(res.meetingUrl, '_blank');
        }, 500);
      }
      void getStudentPortal(month).then(next => setData(next.data));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not join class';
      showToast('error', msg);
    } finally {
      setBusyJoinId(null);
    }
  };
  useEffect(()=>{ if(typeof document==='undefined')return; document.documentElement.dataset.studentRoute='true'; return()=>{delete document.documentElement.dataset.studentRoute;delete document.documentElement.dataset.studentTheme;}; },[]);
  useEffect(()=>{if(typeof document==='undefined')return;let storage:Storage|undefined;try{storage=window.localStorage}catch{storage=undefined}applyStudentTheme(theme,document.documentElement,storage);},[theme]);
  useEffect(()=>{const timer=window.setTimeout(()=>setAppliedSearch(search.trim().toLowerCase()),300);return()=>window.clearTimeout(timer);},[search]);
  useEffect(()=>{let alive=true;setLoading(true);setError('');Promise.allSettled([currentAccount(),getStudentPortal(month)]).then(([auth,portal])=>{if(!alive)return;if(auth.status==='fulfilled')setAccount(auth.value.account);else setAccountError(true);if(portal.status==='fulfilled'){setProfile(portal.value.profile);setData(portal.value.data);setError('');}else setError(portal.reason instanceof Error?portal.reason.message:'Student workspace could not be loaded.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[month]);
  useEffect(()=>{let alive=true;if(page==='notifications'){apiRequest<{meetings:Row[]}>('/api/portal/ptm').then(result=>{if(alive)setNotices(result.meetings||[])}).catch(()=>{if(alive)setNotices([])});}if(page==='doubts'){apiRequest<{records?:Row[];doubts?:Row[]}>('/api/student/doubts').then(result=>{if(alive)setDoubts(result.records||result.doubts||[])}).catch(()=>{if(alive)setDoubts([])});}return()=>{alive=false;};},[page]);
  const go = useCallback((path: string)=>{navigate(path);setDrawer(false);setMessage('');},[navigate]);
  const toggleGroup=(name:string)=>setCollapsed(current=>{const next={...current,[name]:!current[name]};safeStorage('student-nav-collapsed',JSON.stringify(next));return next;});
  const toggleSidebar=()=>setSidebarCollapsed(value=>{safeStorage('student-sidebar-collapsed',String(!value));return !value;});
  const filteredGroups=useMemo(()=>groups.map(group=>({...group,items:group.items.filter(item=>item.label.toLowerCase().includes(menuSearch.trim().toLowerCase()))})).filter(group=>group.items.length),[menuSearch]);
  const profileName=profile?.name||account?.name||'Student';
  const attendance=getArray(data?.attendance),attendanceStats=data?.attendanceSummary||{present:0,absent:0,late:0,excused:0,total:0,rate:null};
  const unread=notices.filter(item=>!localRead.includes(String(item.id))).length;
  const markAllRead=()=>{const ids=notices.map(item=>String(item.id));const next=markStudentNoticesRead(localRead,ids);setLocalRead(next);safeStorage('student-read-notices',JSON.stringify(next));setMessage('Meeting notices marked read on this device.');};
  const updateMonth=(delta:number)=>{const date=new Date(`${month}-01T00:00:00`);date.setMonth(date.getMonth()+delta);setMonth(date.toISOString().slice(0,7));};
  const submitHomework=async(id:string)=>{setBusy(true);setMessage('');try{const {csrfToken}=await apiRequest<{csrfToken:string}>('/api/auth/csrf');await apiRequest('/api/student/assignment-submissions',{method:'POST',headers:{'X-CSRF-Token':csrfToken},body:{assignmentId:id}});const next=await getStudentPortal(month);setData(next.data);setMessage('Assignment submitted.');}catch(cause){setMessage(cause instanceof Error?cause.message:'Assignment could not be submitted.');}finally{setBusy(false);}};
  const handleLogout=()=>{void logout().finally(()=>navigate('/login'));};
  const title=pageTitles[page];
  return <div className="student-theme student-page-bg min-h-screen text-slate-900" data-theme={theme}>
    {toast && (
      <div
        role="status"
        className={`fixed top-5 right-5 z-50 flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl border text-sm font-bold transition-all animate-bounce ${
          toast.type === 'success'
            ? 'bg-emerald-600 border-emerald-500 text-white'
            : 'bg-rose-600 border-rose-500 text-white'
        }`}
      >
        <span className="text-lg">{toast.type === 'success' ? '✓' : '⚠'}</span>
        <div>
          <div>{toast.message}</div>
          {toast.sub && <div className="text-xs font-normal text-white/90">{toast.sub}</div>}
        </div>
      </div>
    )}
    <StudentPageHead title={title} description={pageDescriptions[page]} />
    {drawer&&<button className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" aria-label="Close navigation" onClick={()=>setDrawer(false)}/>}
    <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-[width,transform] lg:translate-x-0 ${sidebarCollapsed?'w-[280px] lg:w-[84px]':'w-[280px]'} ${drawer?'translate-x-0':'-translate-x-full'}`}>
      <div className={`flex h-[76px] items-center border-b border-slate-100 ${sidebarCollapsed?'justify-center px-2':'px-4'}`}><button onClick={()=>go('/student/dashboard')} className="block max-w-full" aria-label="My JEE Mentor student portal"><img src={lightLogo} alt="My JEE Mentor" width="2176" height="570" className={`object-contain object-left ${sidebarCollapsed?'h-12 w-12 rounded-lg object-cover':'h-12 w-auto max-w-full'}`}/></button></div>
      <button className="hidden items-center justify-center gap-2 border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-500 lg:flex" onClick={toggleSidebar} aria-label={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'} title={sidebarCollapsed?'Expand sidebar':'Collapse sidebar'}><AdminIcon name="menu" className="h-4 w-4"/>{!sidebarCollapsed&&'Collapse menu'}</button>
      <div className={`border-b border-slate-100 p-3 ${sidebarCollapsed?'lg:hidden':''}`}><label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><AdminIcon name="search" className="h-4 w-4 text-slate-400"/><input value={menuSearch} onChange={event=>setMenuSearch(event.target.value)} placeholder="Search menu..." className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label></div>
      <nav className="student-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">{filteredGroups.map(group=><section key={group.name}><button onClick={()=>toggleGroup(group.name)} aria-expanded={!collapsed[group.name]} className={`mb-2 flex w-full items-center justify-between px-3 text-left text-[11px] font-black tracking-[.14em] text-slate-500 ${sidebarCollapsed?'lg:hidden':''}`}>{group.name}<span>{collapsed[group.name]?'›':'⌄'}</span></button>{!collapsed[group.name]&&<div className="space-y-1">{group.items.map(item=><button key={item.key} onClick={()=>go(item.path)} title={sidebarCollapsed?item.label:undefined} aria-label={item.label} className={`student-menu-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${sidebarCollapsed?'lg:justify-center lg:px-2':''} ${page===item.key?'student-nav-active':'text-slate-700'}`}><AdminIcon name={item.icon} className="h-5 w-5 shrink-0"/><span className={sidebarCollapsed?'lg:hidden':''}>{item.label}</span></button>)}</div>}</section>)}</nav>
      <div className="border-t border-slate-100 p-3"><div className={`flex items-center gap-3 rounded-xl bg-slate-100 p-3 ${sidebarCollapsed?'lg:justify-center lg:px-1':''}`}><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-black text-white">{initials(profileName)}</span><div className={`min-w-0 ${sidebarCollapsed?'lg:hidden':''}`}><p className="truncate text-sm font-bold">{profileName}</p><p className="text-xs text-slate-500">Student</p></div></div></div>
    </aside>
    <div className={`min-h-screen transition-[padding] ${sidebarCollapsed?'lg:pl-[84px]':'lg:pl-[280px]'}`}>
      <header className="student-shell-header sticky top-0 z-20 flex h-[70px] items-center gap-3 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-5"><button className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 lg:hidden" onClick={()=>setDrawer(true)} aria-label="Open navigation"><AdminIcon name="menu" className="h-5 w-5"/></button><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-400">Student / {title}</p><h1 className="truncate text-lg font-extrabold">{title}</h1></div><label className="hidden max-w-md flex-1 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 md:flex"><AdminIcon name="search" className="h-4 w-4 text-slate-400"/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search students, classes..." className="min-w-0 flex-1 bg-transparent text-sm outline-none"/></label><button aria-label="Notifications" title="Notifications" onClick={()=>go('/student/notifications')} className="relative grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600"><AdminIcon name="bell" className="h-5 w-5"/>{unread>0&&<span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[9px] font-bold text-white">{unread}</span>}</button><button aria-label="Learning tools" title="Learning tools" onClick={()=>go('/student/live-classes')} className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 sm:grid"><AdminIcon name="video" className="h-5 w-5"/></button><button aria-label="My profile" title="My profile" onClick={()=>go('/student/profile')} className="hidden h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 sm:grid"><AdminIcon name="settings" className="h-5 w-5"/></button><button type="button" onClick={()=>setTheme(value=>value==='dark'?'light':'dark')} aria-label={theme==='dark'?'Switch to light mode':'Switch to dark mode'} aria-pressed={theme==='dark'} title={theme==='dark'?'Switch to light mode':'Switch to dark mode'} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600"><AdminIcon name={theme==='dark'?'sun':'moon'} className="h-5 w-5"/></button><button onClick={handleLogout} className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white">Log out</button></header>
      <main className="mx-auto min-h-[calc(100vh-126px)] max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[.16em] student-accent-text">{page==='dashboard'?'Student Portal':'Student Workspace'}{profile?.batchName?` · ${profile.batchName}`:''}</p><h2 className="mt-1 text-3xl font-black student-accent-text">{page==='dashboard'?`Welcome back, ${profileName}!`:title}</h2><p className="mt-1 text-sm text-slate-600">{pageDescriptions[page]}</p></div>{page==='attendance'&&<label className="text-sm font-semibold text-slate-600">Month <input type="month" value={month} onChange={event=>event.target.value&&setMonth(event.target.value)} className={`${input} mt-1 w-auto`}/></label>}</div>
        {accountError&&<div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-white px-5 py-4 text-sm text-rose-700">Your student session could not be verified. <button onClick={handleLogout} className="ml-2 font-bold underline">Sign in again</button></div>}
        {error&&<div role="alert" className="mb-5 flex items-center justify-between gap-4 rounded-2xl border border-rose-200 bg-white px-5 py-4 text-sm text-rose-700">Student information could not be loaded. <button className="font-bold underline" onClick={()=>{setLoading(true);void getStudentPortal(month).then(result=>{setProfile(result.profile);setData(result.data);setError('')}).catch(()=>setError('Student information could not be loaded.')).finally(()=>setLoading(false));}}>Retry</button></div>}
        {message&&<p role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</p>}
        {loading&&!data?<LoadingPage/>:!profile?(error?<LoadError retry={()=>{setLoading(true);void getStudentPortal(month).then(result=>{setProfile(result.profile);setData(result.data);setError('')}).catch(()=>setError('Student workspace could not be loaded.')).finally(()=>setLoading(false));}}/>:<AccessDenied onLogin={handleLogout}/>):<StudentPageContent page={page} profile={profile} data={data||emptyData()} search={appliedSearch} attendance={attendance} attendanceStats={attendanceStats} month={month} onMonth={updateMonth} onNavigate={go} onSubmit={submitHomework} busy={busy} notices={notices} unread={unread} onMarkRead={markAllRead} localRead={localRead} doubts={doubts} account={account} onPrint={()=>window.print()} onJoin={handleJoinClass} busyJoinId={busyJoinId}/>}
      </main>
      <footer className="student-shell-footer flex min-h-14 items-center justify-between border-t border-slate-200 bg-white px-5 text-xs text-slate-600"><span>© 2026 My JEE Mentor</span><span>Coach Sutra v3.0</span></footer>
    </div>
    <MagneticButton className="teacher-magnetic-button student-primary fixed bottom-6 right-6 z-20 grid h-14 w-14 place-items-center rounded-full shadow-lg shadow-orange-900/20" aria-label="Open student chat" title="Open student chat" onClick={()=>go('/student/messages')}><AdminIcon name="chat" className="h-6 w-6"/><span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"/></MagneticButton>
  </div>;
}

function emptyData():StudentPortalData{return{attendance:[],attendanceSummary:{present:0,absent:0,late:0,excused:0,total:0,rate:null},timetable:[],exams:[],results:[],homework:[],fees:[],downloads:[],videos:[],liveClasses:[],subjects:[]};}
function LoadingPage(){return <div role="status" aria-label="Loading student workspace" className="space-y-5"><div className="student-skeleton h-36 rounded-2xl"/><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({length:4},(_,index)=><div key={index} className="student-skeleton h-28 rounded-2xl"/>)}</div><div className="grid gap-5 lg:grid-cols-2"><div className="student-skeleton h-72 rounded-2xl"/><div className="student-skeleton h-72 rounded-2xl"/></div></div>}
function LoadError({retry}:{retry:()=>void}){return <section role="alert" className={`${panel} grid min-h-72 place-items-center p-8 text-center`}><div><AdminIcon name="warning" className="mx-auto h-10 w-10 text-rose-500"/><h2 className="mt-4 text-xl font-black">Student workspace is temporarily unavailable</h2><p className="mt-2 text-sm text-slate-500">Please try loading your information again.</p><button onClick={retry} className={`${button} student-primary mt-5`}>Retry</button></div></section>}
function AccessDenied({onLogin}:{onLogin:()=>void}){return <section className={`${panel} grid min-h-72 place-items-center p-8 text-center`}><div><AdminIcon name="warning" className="mx-auto h-10 w-10 student-accent-text"/><h2 className="mt-4 text-xl font-black">Access denied</h2><p className="mt-2 text-sm text-slate-500">Sign in with the student account assigned to this profile.</p><button onClick={onLogin} className={`${button} student-primary mt-5`}>Go to sign in</button></div></section>}

function StudentPageContent({page,profile,data,search,attendance,attendanceStats,month,onMonth,onNavigate,onSubmit,busy,notices,unread,onMarkRead,localRead,doubts,account,onPrint,onJoin,busyJoinId}:{page:PageKey;profile:StudentPortalProfile;data:StudentPortalData;search:string;attendance:Row[];attendanceStats:StudentPortalData['attendanceSummary'];month:string;onMonth:(delta:number)=>void;onNavigate:(path:string)=>void;onSubmit:(id:string)=>void;busy:boolean;notices:Row[];unread:number;onMarkRead:()=>void;localRead:string[];doubts:Row[];account:Row|null;onPrint:()=>void;onJoin:(row:Row)=>void;busyJoinId:string|null}){
  const exams=getArray(data.exams).filter(row=>matches(row,search,['title','subjectName','subject']));const results=getArray(data.results).filter(row=>matches(row,search,['title','examName','subjectName','subject']));const homework=getArray(data.homework).filter(row=>matches(row,search,['title','subject','subjectName']));const downloads=getArray(data.downloads).filter(row=>matches(row,search,['title','description','subject_name','content_type']));const pending=homework.filter(row=>!['submitted','reviewed','graded','complete','completed'].includes(String(row.status||'').toLowerCase()));const fees=getArray(data.fees);const {total,paid,due}=summarizeStudentFees(fees);const subjects=Array.isArray(data.subjects)?data.subjects:[];
  if(page==='dashboard')return <Dashboard profile={profile} data={data} onNavigate={onNavigate} attendanceStats={attendanceStats} pending={pending} feesDue={due}/>;
  if(page==='timetable')return <Timetable data={data} profile={profile}/>;
  if(page==='attendance')return <Attendance records={attendance} stats={attendanceStats} month={month} onMonth={onMonth} subjectAttendance={data.subjectAttendance} classLog={data.classLog}/>;
  if(page==='exams')return <ListPage title="Scheduled Exams" rows={exams} empty="No scheduled exams" fields={['title','subjectName','scheduledAt','date','status']} />;
  if(page==='results')return <Results rows={results} subjects={subjects}/>;
  if(page==='homework')return <Homework rows={homework} busy={busy} onSubmit={onSubmit}/>;
  if(page==='downloads')return <Downloads rows={downloads} subjects={subjects}/>;
  if(page==='fees')return <Fees rows={fees} total={total} paid={paid} due={due}/>;
  if(page==='id-card')return <IdCard profile={profile} onPrint={onPrint}/>;
  if(page==='certificates')return <Certificates/>;
  if(page==='messages')return <Messages />;
  if(page==='notifications')return <Notifications rows={notices} unread={unread} localRead={localRead} onMarkRead={onMarkRead}/>;
  if(page==='profile')return <Profile profile={profile} account={account}/>;
  if(page==='live-classes')return <LiveClasses rows={getArray(data.liveClasses)} onJoin={onJoin} busyJoinId={busyJoinId}/>;
  if(page==='videos')return <ListPage title="Video Lectures" rows={getArray(data.videos)} empty="No videos are available for your batch." fields={['title','chapter','topic','description']} linkField="external_url"/>;
  if(page==='doubts')return <Doubts rows={doubts} subjects={subjects}/>;
  return <Tutor/>;
}

function matches(row:Row,search:string,fields:string[]){return !search||fields.some(field=>String(row[field]||'').toLowerCase().includes(search));}
function TiltPanel({children,className=''}:{children:React.ReactNode;className?:string}){return <TiltCard className={`student-tilt-card ${panel} ${className}`}>{children}</TiltCard>}
function Stat({label,value,sub,icon='chart',tone='orange'}:{label:string;value:string|number;sub?:string;icon?:string;tone?:'orange'|'green'|'red'|'amber'}){const color=tone==='green'?'text-emerald-600':tone==='red'?'text-rose-600':tone==='amber'?'text-amber-600':'student-accent-text';return <TiltPanel className="p-5"><div className="flex items-center gap-3"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone==='green'?'bg-emerald-50':tone==='red'?'bg-rose-50':tone==='amber'?'bg-amber-50':'bg-orange-50'} ${color}`}><AdminIcon name={icon} className="h-5 w-5"/></span><div className="min-w-0"><p className="truncate text-[11px] font-black tracking-[.12em] text-slate-400">{label.toUpperCase()}</p><p className={`mt-1 text-2xl font-black ${color}`}>{typeof value==='number'?<AnimatedCount value={value}/>:value}</p>{sub&&<p className="mt-0.5 text-xs text-slate-500">{sub}</p>}</div></div></TiltPanel>}
function Section({title,children,action,className=''}:{title:string;children:ReactNode;action?:ReactNode;className?:string}){return <section className={`${panel} ${className}`}><header className="flex items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-5 py-4"><h2 className="font-extrabold">{title}</h2>{action}</header><div className="p-5">{children}</div></section>}
function Empty({children}:{children:ReactNode}){return <div className="grid min-h-32 place-items-center rounded-xl bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">{children}</div>}
function Dashboard({profile,data,onNavigate,attendanceStats,pending,feesDue}:{profile:StudentPortalProfile;data:StudentPortalData;onNavigate:(path:string)=>void;attendanceStats:StudentPortalData['attendanceSummary'];pending:Row[];feesDue:number}){
  const todayName=new Date().toLocaleDateString('en-US',{weekday:'long'}).toLowerCase();const classes=getArray(data.timetable).filter(row=>String(row.day||'').toLowerCase()===todayName).sort((a,b)=>String(a.startTime||'').localeCompare(String(b.startTime||'')));const exams=getArray(data.exams).filter(row=>{const date=String(row.scheduledAt||row.date||'').slice(0,10);return !date||date>=new Date().toISOString().slice(0,10)}).slice(0,4);const results=getArray(data.results);const scores=results.map(row=>Number(row.score??row.marksObtained??row.percentage)).filter(Number.isFinite);const avg=scores.length?Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length):null;const rank=results.map(row=>Number(row.rank)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
  return <div className="space-y-5"><section className="student-accent student-welcome-banner overflow-hidden rounded-2xl p-6 shadow-sm sm:p-8"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-black uppercase tracking-[.16em] text-orange-50">STUDENT PORTAL · {profile.batchName||'YOUR BATCH'}</p><h2 className="mt-2 text-3xl font-black text-white">Welcome back, {profile.name}!</h2><p className="mt-2 text-sm text-white/85">{new Date().toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})} · Admission #{profile.admissionNumber}</p></div><div className="flex flex-wrap gap-2">{[[attendanceStats.rate==null?'—':`${attendanceStats.rate}%`,'Attendance'],[rank?`#${rank}`:'—','Rank'],[avg==null?'—':`${avg}%`,'Avg Score']].map(([value,label])=><span key={label} className="student-banner-chip rounded-full px-3 py-2 text-sm font-bold text-white">{value} {label}</span>)}</div></div></section>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Attendance %" value={attendanceStats.rate==null?'—':`${attendanceStats.rate}%`} icon="checklist" tone={attendanceStats.rate!=null&&attendanceStats.rate<75?'amber':'green'}/><Stat label="Class Rank" value={rank?`#${rank}`:'—'} icon="trophy"/><Stat label="Pending HW" value={pending.length} icon="pencil" tone={pending.length?'amber':'green'}/><Stat label="Fee Dues" value={formatMoney(feesDue)} icon="rupee" tone={feesDue?'red':'green'}/></div>
    <Section title="Quick Access"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{quickLinks.map(item=><button key={item.key} onClick={()=>onNavigate(item.path)} className="student-quick-tile student-soft rounded-xl border border-slate-100 p-4 text-left hover:-translate-y-0.5 hover:shadow-md"><span className="grid h-10 w-10 place-items-center rounded-xl bg-white student-accent-text"><AdminIcon name={item.icon} className="h-5 w-5"/></span><span className="mt-3 block text-sm font-bold">{item.label}</span></button>)}</div></Section>
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]"><Section title="Today's Schedule" action={<button onClick={()=>onNavigate('/student/timetable')} className="text-sm font-bold student-accent-text">Full timetable →</button>}>{classes.length?<div className="space-y-3">{classes.map((row,index)=><div key={row.id||`${row.startTime}-${index}`} className="flex gap-4 rounded-xl bg-slate-50 p-3"><b className="min-w-20 text-sm student-accent-text">{row.startTime||'—'}</b><div><p className="font-bold">{row.subjectName||row.subject||'Class'}{row.topic?` · ${row.topic}`:''}</p><p className="text-xs text-slate-500">{row.teacherName||''}</p></div></div>)}</div>:<Empty>No classes scheduled for today.</Empty>}</Section><Section title="Upcoming Exams" action={<button onClick={()=>onNavigate('/student/exams')} className="text-sm font-bold student-accent-text">View all →</button>}>{exams.length?<ul className="space-y-3">{exams.map((exam,index)=><li key={exam.id||index} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3"><span className="font-semibold">{exam.title||exam.name||'Exam'}</span><span className="text-xs text-slate-500">{formatDate(exam.scheduledAt||exam.date)}</span></li>)}</ul>:<Empty>No upcoming exams.</Empty>}</Section></div>
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]"><Section title="Academic Progress Trend"><ProgressChart rows={results}/></Section><div className="space-y-5"><Section title="Attendance" action={<button onClick={()=>onNavigate('/student/attendance')} className="text-sm font-bold student-accent-text">Details →</button>}>{attendanceStats.total?<><div className="flex items-end justify-between"><b className="text-3xl">{attendanceStats.rate}%</b><span className="text-xs text-slate-500">{attendanceStats.present} Present / {attendanceStats.absent} Absent / {attendanceStats.total} Total</span></div><div className="mt-3 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-500" style={{width:`${attendanceStats.rate}%`}}/></div></>:<Empty>No attendance recorded yet.</Empty>}</Section><Section title="Subject Breakdown">{data.subjects.length?<div className="space-y-3">{data.subjects.map(subject=>{const marks=results.filter(row=>String(row.subjectName||row.subject||'')===subject.name).map(row=>Number(row.score??row.percentage)).filter(Number.isFinite);const value=marks.length?Math.round(marks.reduce((a,b)=>a+b,0)/marks.length):0;return <div key={subject.id}><div className="flex justify-between text-sm"><b>{subject.name}</b><span>{marks.length?`${value}%`:'—'}</span></div><div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-orange-500" style={{width:`${value}%`}}/></div></div>})}</div>:<Empty>No subject scores recorded yet.</Empty>}</Section><Section title="Pending Homework" action={<button onClick={()=>onNavigate('/student/homework')} className="text-sm font-bold student-accent-text">View all →</button>}>{pending.length?pending.slice(0,3).map((row,index)=><div key={row.id||index} className="border-b border-slate-100 py-2"><b className="text-sm">{row.title}</b><p className="text-xs text-slate-500">Due {formatDate(row.dueDate)}</p></div>):<Empty>All homework completed!</Empty>}</Section></div></div>
  </div>;
}
function ProgressChart({rows}:{rows:Row[]}){const data=rows.slice(0,8).reverse().map((row,index)=>({label:row.title||row.examName||`Test ${index+1}`,value:Math.max(0,Math.min(100,Number(row.percentage??row.score??row.marksObtained)||0))}));if(!data.length)return <Empty>No published test scores yet.</Empty>;return <div className="grid h-52 grid-cols-8 items-end gap-3 border-b border-l border-slate-200 px-2 pb-2 pt-4">{data.map((item,index)=><div key={`${item.label}-${index}`} className="flex h-full flex-col items-center justify-end gap-2"><div className="student-animate-bar w-full max-w-10 rounded-t-lg bg-orange-500" style={{height:`${Math.max(4,item.value)}%`}} title={`${item.label}: ${item.value}%`}/><span className="max-w-full truncate text-[10px] text-slate-500">{index+1}</span></div>)}</div>}
function Timetable({data,profile}:{data:StudentPortalData;profile:StudentPortalProfile}){const today=new Date();const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];const weekStart=new Date(today);const day=(today.getDay()+6)%7;weekStart.setDate(today.getDate()-day);const classes=getArray(data.timetable);const todayName=today.toLocaleDateString('en-US',{weekday:'long'});const todays=classes.filter(row=>String(row.day||'').toLowerCase()===todayName.toLowerCase());return <div className="space-y-5"><section className="student-accent rounded-2xl p-5 text-white"><p className="text-xs font-black uppercase tracking-widest">{profile.batchName||'Student schedule'}</p><h2 className="mt-1 text-2xl font-black">{todays.length?`${todays.length} class${todays.length===1?'':'es'} today`:'No classes today, enjoy your free day or review past notes!'}</h2><p className="mt-1 text-sm text-white/85">{today.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p></section><Section title="My Weekly Schedule" className="student-static"><p className="mb-4 text-sm text-slate-500">Week of {formatDate(weekStart.toISOString().slice(0,10))}</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{weekdays.map((name,index)=>{const date=new Date(weekStart);date.setDate(weekStart.getDate()+index);const rows=classes.filter(row=>String(row.day||'').toLowerCase()===name.toLowerCase()).sort((a,b)=>String(a.startTime||'').localeCompare(String(b.startTime||'')));const isToday=date.toDateString()===today.toDateString();return <article key={name} className={`rounded-xl border p-4 ${isToday?'border-orange-300 bg-orange-50/70':'border-slate-100 bg-white'}`}><header className="flex items-center justify-between"><span className={`font-black ${isToday?'student-accent-text':''}`}>{name}</span><span className="text-xs text-slate-500">{date.getDate()} {date.toLocaleDateString('en-IN',{month:'short'})}{isToday&&<b className="ml-2 rounded-full bg-orange-500 px-2 py-1 text-[9px] text-white">TODAY</b>}</span></header><div className="mt-3 space-y-2">{rows.length?rows.map((row,rowIndex)=><div key={row.id||rowIndex} className="rounded-lg bg-slate-50 p-3"><p className="font-bold">{row.subjectName||row.subject||'Class'}</p><p className="mt-1 text-xs text-slate-500">{row.startTime||'—'}{row.endTime?` – ${row.endTime}`:''}{row.topic?` · ${row.topic}`:''}</p></div>):<p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-400">No classes</p>}</div></article>})}</div></Section></div>}
function Attendance({
  records,
  stats,
  month,
  onMonth,
  subjectAttendance = [],
  classLog = [],
}: {
  records: Row[];
  stats: StudentPortalData['attendanceSummary'];
  month: string;
  onMonth: (delta: number) => void;
  subjectAttendance?: Array<{ id: string; name: string; teacher: string; held: number; attended: number; missed: number; rate: number; enrolled: boolean }>;
  classLog?: Array<{ id: string; date: string; subjectName: string; teacherName: string; time: string; status: string; joinTime?: string }>;
}) {
  const date = new Date(`${month}-01T00:00:00`);
  const first = (date.getDay() + 6) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const byDay = new Map(records.map(row => [String(row.date || '').slice(0, 10), String(row.status || '').toLowerCase()]));
  const state = studentAttendanceState(stats.total, stats.rate);

  const displaySubjects = subjectAttendance.length ? subjectAttendance : [
    { id: '1', name: 'Physics', teacher: 'Alok Sir', held: 12, attended: 12, missed: 0, rate: 100, enrolled: true },
    { id: '2', name: 'Maths', teacher: 'R.K. Gupta', held: 10, attended: 10, missed: 0, rate: 100, enrolled: true },
    { id: '3', name: 'Chemistry', teacher: 'Dr. Verma', held: 8, attended: 8, missed: 0, rate: 100, enrolled: true },
    { id: '4', name: 'Biology', teacher: 'Dr. Neha', held: 0, attended: 0, missed: 0, rate: 0, enrolled: false },
  ];

  return (
    <div className="space-y-6">
      {/* 4 Stat Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Present" value={stats.present} icon="check" tone="green" />
        <Stat label="Absent" value={stats.absent} icon="close" tone="red" />
        <Stat label="Late" value={stats.late} icon="clock" tone="amber" />
        <Stat label="Attendance %" value={stats.rate == null ? '—' : `${stats.rate}%`} icon="chart" tone={state === 'below-threshold' ? 'red' : 'orange'} />
      </div>

      {state === 'below-threshold' && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          Your attendance is below the required 75%.
        </div>
      )}

      {/* Subject-wise Cards */}
      <Section title="Subject-wise Attendance">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {displaySubjects.map(sub => {
            if (!sub.enrolled) {
              return (
                <article
                  key={sub.id}
                  className="rounded-2xl border border-slate-200 p-5 shadow-sm"
                  style={{
                    backgroundImage: 'repeating-linear-gradient(45deg, rgba(148,163,184,0.12), rgba(148,163,184,0.12) 8px, transparent 8px, transparent 16px)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-600">{sub.name}</h3>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      Not Enrolled
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Subject not enrolled</p>
                </article>
              );
            }
            return (
              <article key={sub.id} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-black text-slate-900">{sub.name}</h3>
                    <p className="text-xs text-slate-500">{sub.teacher}</p>
                  </div>
                  <span className="text-xl font-black text-emerald-600">{sub.rate}%</span>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-xl bg-slate-50 p-2">
                    <b className="block text-slate-800">{sub.held}</b>
                    <span className="text-[10px] text-slate-400">Held</span>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-2">
                    <b className="block text-emerald-600">{sub.attended}</b>
                    <span className="text-[10px] text-emerald-700">Attended</span>
                  </div>
                  <div className="rounded-xl bg-rose-50 p-2">
                    <b className="block text-rose-600">{sub.missed}</b>
                    <span className="text-[10px] text-rose-700">Missed</span>
                  </div>
                </div>
                <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-orange-500" style={{ width: `${sub.rate}%` }} />
                </div>
              </article>
            );
          })}
        </div>
      </Section>

      {/* Monthly Calendar */}
      <Section title="Monthly Calendar" className="student-static">
        <div className="mb-4 flex items-center justify-between">
          <button className={`${button} border border-slate-200`} aria-label="Previous month" onClick={() => onMonth(-1)}>‹</button>
          <h3 className="font-black">{date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h3>
          <button className={`${button} border border-slate-200`} aria-label="Next month" onClick={() => onMonth(1)}>›</button>
        </div>
        {state === 'empty' ? (
          <Empty>No attendance recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid min-w-[560px] grid-cols-7 gap-1 text-center">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <b key={day} className="py-2 text-xs text-slate-500">{day}</b>
              ))}
              {Array.from({ length: first }, (_, i) => (
                <span key={`blank-${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const number = i + 1;
                const key = `${month}-${String(number).padStart(2, '0')}`;
                const status = byDay.get(key);
                const color = status && ['p', 'present'].includes(status)
                  ? 'bg-emerald-100 text-emerald-800'
                  : status && ['a', 'absent'].includes(status)
                  ? 'bg-rose-100 text-rose-800'
                  : status === 'late'
                  ? 'bg-amber-100 text-amber-900'
                  : status
                  ? 'bg-sky-100 text-sky-800'
                  : 'bg-slate-50 text-slate-600';
                return (
                  <span
                    key={key}
                    title={status || 'No record'}
                    className={`grid h-11 place-items-center rounded-lg border border-transparent text-sm font-semibold ${color} ${
                      new Date().toISOString().slice(0, 10) === key ? '!border-orange-500' : ''
                    }`}
                  >
                    {number}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-600">
          {[['Present', 'bg-emerald-500'], ['Absent', 'bg-rose-500'], ['Late', 'bg-amber-500'], ['Excused', 'bg-sky-500']].map(([label, color]) => (
            <span key={label} className="flex items-center gap-2">
              <i className={`h-2.5 w-2.5 rounded-full ${color}`} />
              {label}
            </span>
          ))}
        </div>
      </Section>

      {/* Class Join Log */}
      <Section title="Recent Class Attendance Log">
        {classLog.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Teacher</th>
                  <th className="px-4 py-3">Scheduled Time</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {classLog.map(item => (
                  <tr key={item.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-semibold">{item.date}</td>
                    <td className="px-4 py-3 font-bold text-slate-900">{item.subjectName}</td>
                    <td className="px-4 py-3 text-slate-500">{item.teacherName}</td>
                    <td className="px-4 py-3 text-slate-500">{item.time}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                        ✓ {item.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No live class joins recorded yet this month.</Empty>
        )}
      </Section>
    </div>
  );
}

function LiveClasses({
  rows,
  onJoin,
  busyJoinId
}: {
  rows: Row[];
  onJoin: (row: Row) => void;
  busyJoinId: string | null;
}) {
  return (
    <Section title="Live Classes">
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const isJoining = busyJoinId === String(row.id);
            return (
              <article
                key={row.id || index}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-100 p-4 hover:border-orange-200 transition"
              >
                <div>
                  <h3 className="font-bold text-slate-900">
                    {row.title || row.topic || 'Online Class'}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {row.subject_name || row.subjectName || 'Subject'} • {formatDate(row.scheduled_at)} • {row.provider || 'Zoom'}
                  </p>
                </div>
                <div>
                  <button
                    disabled={isJoining}
                    onClick={() => onJoin(row)}
                    className={`${button} student-primary`}
                  >
                    {isJoining ? 'Joining…' : row.has_joined ? '✓ Rejoin' : 'Join'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <Empty>No live classes are scheduled for your batch.</Empty>
      )}
    </Section>
  );
}


function ListPage({title,rows,empty,fields,joinField,linkField}:{title:string;rows:Row[];empty:string;fields:string[];joinField?:string;linkField?:string}){return <Section title={title}>{rows.length?<div className="space-y-3">{rows.map((row,index)=><article key={row.id||index} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-100 p-4"><div><h3 className="font-bold">{row.title||row.name||row.subjectName||'Class'}</h3><p className="mt-1 text-sm text-slate-500">{fields.slice(1).map(field=>row[field]?(field.toLowerCase().includes('date')||field.toLowerCase().includes('at')?formatDate(row[field]):row[field]):'').filter(Boolean).join(' · ')}</p></div>{joinField&&row[joinField]&&<a href={row[joinField]} target="_blank" rel="noreferrer" className={`${button} student-primary`}>Join</a>}{linkField&&row[linkField]&&<a href={row[linkField]} target="_blank" rel="noreferrer" className={`${button} border border-slate-200`}>Open video</a>}</article>)}</div>:<Empty>{empty}</Empty>}</Section>}
function Results({rows,subjects}:{rows:Row[];subjects:Array<{id:string;name:string}>}){const scores=rows.map(row=>Number(row.score??row.percentage??row.marksObtained)).filter(Number.isFinite);const average=scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):null;const bySubject=subjects.map(subject=>{const list=rows.filter(row=>String(row.subjectName||row.subject||'')===subject.name).map(row=>Number(row.score??row.percentage??row.marksObtained)).filter(Number.isFinite);return {name:subject.name,score:list.length?Math.round(list.reduce((a,b)=>a+b,0)/list.length):null}});const best=[...bySubject].filter(item=>item.score!=null).sort((a,b)=>(b.score||0)-(a.score||0))[0];const low=[...bySubject].filter(item=>item.score!=null).sort((a,b)=>(a.score||0)-(b.score||0))[0];return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Tests Taken" value={rows.length} icon="quiz"/><Stat label="Overall Average" value={average==null?'—':`${average}%`} icon="chart"/><Stat label="Best Subject" value={best?.name||'—'} icon="trophy" tone="green"/><Stat label="Needs Work" value={low?.name||'—'} icon="warning" tone="amber"/></div><Section title="Subject Performance">{bySubject.some(item=>item.score!=null)?<div className="grid gap-4 sm:grid-cols-2">{bySubject.filter(item=>item.score!=null).map(item=><div key={item.name}><div className="flex justify-between text-sm"><b>{item.name}</b><span>{item.score}%</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500" style={{width:`${item.score}%`}}/></div></div>)}</div>:<Empty>No results yet.</Empty>}</Section><Section title="All Results" className="student-static">{rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[660px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Subject / Exam','Score','Grade','Rank','Date of exam'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index)=><tr key={row.id||index}><td className="px-3 py-4 font-semibold">{row.subjectName||row.subject||'—'}{(row.title||row.examName)&&<small className="block font-normal text-slate-500">{row.title||row.examName}</small>}</td><td className="px-3 py-4">{row.percentage!=null?`${row.percentage}%`:row.score??row.marksObtained??'—'}</td><td className="px-3 py-4">{row.grade||'—'}</td><td className="px-3 py-4">{row.rank||'—'}</td><td className="px-3 py-4">{formatDate(row.examDate||row.date||row.createdAt)}</td></tr>)}</tbody></table></div>:<Empty>No results published yet.</Empty>}</Section></div>}
function Homework({rows,busy,onSubmit}:{rows:Row[];busy:boolean;onSubmit:(id:string)=>void}){const pending=rows.filter(row=>!['submitted','reviewed','graded','complete','completed'].includes(String(row.status||'').toLowerCase()));const submitted=rows.filter(row=>!pending.includes(row));return <div className="grid gap-5 xl:grid-cols-2">{[['Pending',pending],['Submitted',submitted]].map(([label,list])=><Section key={String(label)} title={String(label)}>{(list as Row[]).length?(list as Row[]).map((row,index)=><article key={row.id||index} className="mb-3 rounded-xl border border-slate-100 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{row.title||'Homework'}</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">{row.status||'Assigned'}</span></div><p className="mt-1 text-sm text-slate-500">{row.subjectName||row.subject||''} · Due {formatDate(row.dueDate)}</p>{row.description&&<p className="mt-3 text-sm">{row.description}</p>}{pending.includes(row)&&<button disabled={busy} onClick={()=>onSubmit(String(row.id))} className={`${button} student-primary mt-3`}>Submit work</button>}{row.submission?.feedback&&<p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">Teacher feedback: {row.submission.feedback}</p>}</article>):<Empty>{label==='Pending'?'All homework completed!':'No submissions yet.'}</Empty>}</Section>)}</div>}
function Fees({rows,total,paid,due}:{rows:Row[];total:number;paid:number;due:number}){return <div className="space-y-5"><div className="grid gap-4 sm:grid-cols-3"><Stat label="Total Fees" value={formatMoney(total)} icon="rupee"/><Stat label="Amount Paid" value={formatMoney(paid)} icon="check" tone="green"/><Stat label="Amount Due" value={formatMoney(due)} icon="warning" tone={due?'amber':'green'}/></div>{due===0&&<div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 font-semibold text-emerald-800">All fees are paid up to date</div>}<Section title="Fee Installments" className="student-static">{rows.length?<div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Description','Total','Paid','Due','Due Date','Status','Action'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map((row,index)=><tr key={row.id||index}><td className="px-3 py-4 font-semibold">{row.title||'Fee installment'}</td><td className="px-3 py-4">{formatMoney(row.total)}</td><td className="px-3 py-4 text-emerald-700">{formatMoney(row.paid)}</td><td className="px-3 py-4">{formatMoney(row.due)}</td><td className="px-3 py-4">{formatDate(row.dueDate)}</td><td className="px-3 py-4">{row.due<=0?'Paid':row.status||'Due'}</td><td className="px-3 py-4 text-slate-400">—</td></tr>)}</tbody></table></div>:<Empty>No fee records found.</Empty>}</Section></div>}
function Downloads({rows,subjects}:{rows:Row[];subjects:Array<{id:string;name:string}>}){const [type,setType]=useState('all');const [subject,setSubject]=useState('all');const [query,setQuery]=useState('');const filtered=rows.filter(row=>(type==='all'||String(row.content_type||'').toLowerCase()===type.toLowerCase())&&(subject==='all'||String(row.subject_name||'')===subject)&&matches(row,query.toLowerCase(),['title','description','subject_name']));return <div className="space-y-5"><section className="rounded-2xl bg-[#1a1c1f] p-6 text-white sm:p-8"><p className="text-xs font-black uppercase tracking-widest text-orange-300">Student Downloads</p><h2 className="mt-2 text-3xl font-black">Download Center</h2><p className="mt-2 max-w-3xl text-sm text-slate-300">Access study materials, notes, formula sheets, syllabus, and question papers shared by your teachers.</p></section><Section title="Study Materials"><div className="mb-4 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr]"><input className={input} placeholder="Search by document title..." value={query} onChange={event=>setQuery(event.target.value)}/><select className={input} aria-label="Filter by content type" value={type} onChange={event=>setType(event.target.value)}><option value="all">All Content Types</option>{['Assignment','Syllabus','Notes','Study Material','Question Paper','Exam Paper','Notice','eBook','Video','Holiday Homework','Other Downloads'].map(item=><option key={item} value={item}>{item}</option>)}</select><select className={input} aria-label="Filter by subject" value={subject} onChange={event=>setSubject(event.target.value)}><option value="all">All Subjects</option>{subjects.map(item=><option key={item.id} value={item.name}>{item.name}</option>)}</select></div>{filtered.length?<div className="grid gap-3 md:grid-cols-2">{filtered.map((row,index)=><article key={row.id||index} className="flex items-center gap-4 rounded-xl border border-slate-100 p-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-50 student-accent-text"><AdminIcon name="download" className="h-5 w-5"/></span><div className="min-w-0 flex-1"><p className="truncate font-bold">{row.title}</p><p className="mt-1 truncate text-xs text-slate-500">{row.subject_name||'General'} · {row.content_type||'Document'}</p></div>{row.external_url?<a className={`${button} border border-slate-200`} href={row.external_url} target="_blank" rel="noreferrer">Open</a>:<span className="text-xs text-slate-400">No public link</span>}</article>)}</div>:<Empty><span><b className="block text-base text-slate-700">No Documents Available</b><span className="mt-1 block">There are no downloadable documents shared with your batch at this time.</span></span></Empty>}</Section></div>}
function IdCard({profile,onPrint}:{profile:StudentPortalProfile;onPrint:()=>void}){return <div className="mx-auto max-w-3xl"><section className="student-id-card overflow-hidden rounded-3xl border border-orange-200 bg-white shadow-lg"><header className="student-accent p-6 text-center"><p className="text-sm font-black tracking-[.18em]">JEE MENTOR</p><h2 className="mt-1 text-2xl font-black">Student Identity Card</h2></header><div className="grid gap-6 p-6 sm:grid-cols-[160px_1fr] sm:p-8"><div className="grid h-40 w-40 place-items-center rounded-2xl bg-orange-50 text-5xl font-black student-accent-text">{initials(profile.name)}</div><dl className="grid content-start gap-4 sm:grid-cols-2">{[['Name',profile.name],['ID No.',profile.admissionNumber],['Batch',profile.batchName||'—'],['Date of Birth',formatDate(profile.dateOfBirth)],['Phone',profile.phone||'—']].map(([key,value])=><div key={key}><dt className="text-xs font-black uppercase tracking-wider text-slate-400">{key}</dt><dd className="mt-1 font-bold">{value}</dd></div>)}</dl></div><footer className="border-t border-slate-100 px-6 py-4 text-center text-sm text-slate-500">My JEE Mentor · Institute Student Identity Card</footer></section><div className="student-no-print mt-5 flex justify-center"><button onClick={onPrint} className={`${button} student-primary`}><AdminIcon name="download" className="h-4 w-4"/>Print / Save as PDF</button></div><p className="student-no-print mt-3 text-center text-xs text-slate-500">Use your browser’s “Save as PDF” option in the print dialog.</p></div>}
function Certificates(){return <Section title="My Documents"><div className="grid gap-4 md:grid-cols-3">{['ID Card','Bonafide Certificate','Character Certificate'].map((name,index)=><article key={name} className="rounded-xl border border-slate-100 p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-orange-50 student-accent-text"><AdminIcon name={index?'file':'student'} className="h-5 w-5"/></span><h3 className="mt-4 font-bold">{name}</h3><p className="mt-1 text-xs text-slate-500">{index?'No document has been issued.':'Available from your student profile.'}</p>{!index&&<a href="/student/id-card" className="mt-3 inline-block text-sm font-bold student-accent-text">View ID Card →</a>}</article>)}</div></Section>}
function Messages(){return <div className={`${panel} grid min-h-[520px] overflow-hidden md:grid-cols-[280px_1fr]`}><section className="border-b border-slate-100 p-5 md:border-b-0 md:border-r"><h2 className="font-extrabold">Contacts</h2><input className={`${input} mt-4`} placeholder="Search contacts..." disabled/><Empty>No messaging contacts available yet.</Empty></section><section className="grid place-items-center p-6 text-center"><div><AdminIcon name="chat" className="mx-auto h-10 w-10 text-slate-400"/><h2 className="mt-3 font-bold">Select a contact to start messaging</h2><p className="mt-2 max-w-md text-sm text-slate-500">Direct student messaging is not enabled in the current message storage.</p><div className="mt-5 flex gap-2"><input className={input} placeholder="Write a message..." disabled/><button disabled className={`${button} student-primary`}>Send</button></div></div></section></div>}
function Notifications({rows,unread,localRead,onMarkRead}:{rows:Row[];unread:number;localRead:string[];onMarkRead:()=>void}){return <Section title={`${unread} unread notification${unread===1?'':'s'}`} action={<button disabled={!unread} onClick={onMarkRead} className={`${button} border border-slate-200`}>Mark All Read</button>}>{rows.length?<div className="space-y-3">{rows.map((row,index)=>{const read=localRead.includes(String(row.id));return <article key={row.id||index} className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-100 p-4"><span className={`grid h-10 w-10 place-items-center rounded-full ${read?'bg-slate-100 text-slate-500':'bg-orange-50 student-accent-text'}`}><AdminIcon name="bell" className="h-5 w-5"/></span><div className="min-w-0 flex-1"><p className="font-bold">{row.title||'Parent Teacher Meeting update'}</p><p className="mt-1 text-sm text-slate-500">{row.batch_name} · {row.teacher_name} · {formatDate(row.scheduled_at)}</p></div><span className="text-xs text-slate-500">{read?'Read':'Unread'}</span>{row.status==='scheduled'&&row.meeting_url&&<a href={row.meeting_url} target="_blank" rel="noreferrer" className={`${button} student-primary`}>View / Join</a>}</article>})}<p className="text-xs text-slate-500">Read status is kept on this device. Your institute has not enabled server-side notification receipts.</p></div>:<Empty>No notifications yet.</Empty>}</Section>}
function Profile({profile,account}:{profile:StudentPortalProfile;account:Row|null}){return <div className="grid gap-5 xl:grid-cols-[.8fr_1.5fr]"><Section title="My Profile"><div className="text-center"><span className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-orange-500 text-3xl font-black text-white">{initials(profile.name)}</span><h2 className="mt-4 text-xl font-black">{profile.name}</h2><p className="mt-1 text-sm text-slate-500">Admission No: {profile.admissionNumber}</p><span className="mt-3 inline-block rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-900">{profile.batchName||'No batch assigned'}</span></div><div className="mt-6 space-y-3 text-sm"><p className="flex justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-slate-500">Course</span><b>{profile.courseName||'—'}</b></p><p className="flex justify-between gap-3 border-t border-slate-100 pt-3"><span className="text-slate-500">Status</span><b>{profile.status}</b></p></div></Section><div className="space-y-5"><Section title="Personal Information"><div className="grid gap-4 sm:grid-cols-2">{[['Full Name',profile.name],['Email',profile.email],['Phone',profile.phone],['Date of Birth',formatDate(profile.dateOfBirth)]].map(([label,value])=><label key={label} className="text-xs font-black uppercase tracking-wide text-slate-600">{label}<input readOnly value={value||'—'} className={`${input} mt-1.5 bg-slate-50 font-normal normal-case tracking-normal`}/></label>)}</div><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">Profile editing is disabled for your branch.</p></Section><Section title="Change Password"><p className="text-sm text-slate-500">{account?.mustChangePassword?'Use the secure password-change flow to update your initial password.':'Password changes are managed by your institute administrator.'}</p>{account?.mustChangePassword&&<a href="/change-password" className="mt-3 inline-block font-bold student-accent-text">Change your password →</a>}</Section><Section title="My Documents"><div className="grid gap-3 sm:grid-cols-3">{['ID Card','Bonafide Certificate','Character Certificate'].map((item,index)=><a key={item} href={index===0?'/student/id-card':'/student/certificates'} className="rounded-xl border border-slate-100 p-4 font-bold hover:border-orange-300">{item}<span className="mt-2 block text-xs font-normal text-slate-500">{index===0?'View / print':'No document available'}</span></a>)}</div></Section></div></div>}
function Doubts({rows,subjects}:{rows:Row[];subjects:Array<{id:string;name:string}>}){const [title,setTitle]=useState(''),[question,setQuestion]=useState(''),[subject,setSubject]=useState(''),[items,setItems]=useState(rows),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);useEffect(()=>setItems(rows),[rows]);const send=async(event:React.FormEvent)=>{event.preventDefault();if(!title.trim()||!question.trim()||!subject)return;setBusy(true);setNotice('');try{const {csrfToken}=await apiRequest<{csrfToken:string}>('/api/auth/csrf');const result=await apiRequest<{record:Row}>('/api/student/doubts',{method:'POST',headers:{'X-CSRF-Token':csrfToken},body:{title,question,subjectId:subject}});setItems(current=>[result.record,...current]);setTitle('');setQuestion('');setNotice('Your question was sent to your teacher.');}catch(cause){setNotice(cause instanceof Error?cause.message:'Your question could not be sent.');}finally{setBusy(false);}};return <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]"><Section title="Ask a question"><form onSubmit={event=>void send(event)} className="space-y-3"><input className={input} required maxLength={180} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Question title"/><label className="block text-xs font-bold">SUBJECT<select required className={`${input} mt-1.5`} value={subject} onChange={event=>setSubject(event.target.value)}><option value="">Choose subject</option>{subjects.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><textarea required maxLength={4000} rows={5} className={input} value={question} onChange={event=>setQuestion(event.target.value)} placeholder="Describe your doubt..."/><button disabled={busy||!subjects.length} className={`${button} student-primary`}>{busy?'Sending…':'Send question'}</button>{!subjects.length&&<p className="text-xs text-slate-500">Add subjects to your batch before submitting a question.</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}</form></Section><Section title="My Doubts">{items.length?items.map((row,index)=><article key={row.id||index} className="mb-3 rounded-xl border border-slate-100 p-4"><div className="flex justify-between gap-3"><b>{row.title}</b><span className="text-xs text-slate-500">{row.status||'Open'}</span></div><p className="mt-2 text-sm text-slate-600">{row.question}</p><p className="mt-1 text-xs text-slate-500">{row.subjectName||''} · {formatDate(row.createdAt)}</p></article>):<Empty>No doubts submitted yet.</Empty>}</Section></div>}
function Tutor(){return <Section title="AI Tutor"><div className="rounded-2xl bg-orange-50 p-5 text-orange-950"><h2 className="text-lg font-black">Study support</h2><p className="mt-2 text-sm">Your institute has not connected a student-facing AI Tutor service. Ask a teacher through My Doubts for help with a topic.</p><a href="/student/doubts" className="mt-4 inline-block font-bold text-orange-900 underline">Open My Doubts →</a></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><article className="rounded-xl border border-slate-100 p-4"><h3 className="font-bold">Study plan</h3><p className="mt-1 text-sm text-slate-500">Your plan will appear here when one is shared with your account.</p></article><article className="rounded-xl border border-slate-100 p-4"><h3 className="font-bold">Recommended topics</h3><p className="mt-1 text-sm text-slate-500">Recommendations are not available yet.</p></article></div></Section>}
