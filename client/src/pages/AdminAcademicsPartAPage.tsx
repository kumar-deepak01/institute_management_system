import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { assignSubstitute, createHoliday, createLeaveBalance, createLeaveType, deleteLeaveRecord, deleteTimetableClass, getLiveAttendanceSummary, getLeaveLookups, getLeaveRequests, getRegularizations, getTimetable, reviewLeave, saveTeacherAvailability, saveTimetableClass, timetableLookups } from '../services/academicOperations';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const dateLabel = (value: string) => { if (!value) return '—'; const d = new Date(`${value.slice(0,10)}T00:00:00`); return Number.isNaN(d.valueOf()) ? value : d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); };
const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const typeColors: Record<string,string> = { Lecture:'blue', Lab:'cyan', Doubt:'amber', Test:'rose', Special:'violet' };
const typeStyles:Record<string,string>={Lecture:'border-blue-500 bg-blue-50',Lab:'border-cyan-500 bg-cyan-50',Doubt:'border-amber-500 bg-amber-50',Test:'border-rose-500 bg-rose-50',Special:'border-violet-500 bg-violet-50'};
const legendStyles:Record<string,string>={Lecture:'bg-blue-100 text-orange-600',Lab:'bg-cyan-100 text-cyan-700',Doubt:'bg-amber-100 text-amber-700',Test:'bg-rose-100 text-rose-700',Special:'bg-violet-100 text-violet-700'};
const inputClass = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:opacity-50';
function Icon({name}:{name:string}) { const p:Record<string,string>={calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',filter:'M4 5h16l-6 7v6l-4 2v-8z',plus:'M12 5v14m-7-7h14',clock:'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',check:'m5 12 4 4L19 6',close:'M6 6l12 12M18 6 6 18',search:'m20 20-4.5-4.5M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0',print:'M6 9V3h12v6M6 18H4V9h16v9h-2M6 14h12v7H6z',download:'M12 3v12m-5-5 5 5 5-5M4 19h16',grid:'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',edit:'m4 16-.8 4.8L8 20l12-12-4-4z',trash:'M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3'}; return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={p[name]||p.calendar}/></svg>; }
function PageHeader({title,subtitle,actions}:{title:string;subtitle:string;actions?:React.ReactNode}) { return <header className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-black tracking-tight text-slate-800">{title}</h1><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div><div className="flex flex-wrap gap-2">{actions}</div></header>; }
function Panel({title,children,action}:{title:string;children:React.ReactNode;action?:React.ReactNode}) { return <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm"><div className="flex min-h-14 items-center justify-between gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-100/70 to-orange-50/50 px-5 py-3"><h2 className="font-extrabold text-slate-800">{title}</h2>{action}</div>{children}</section>; }
function Stat({label,value,color}:{label:string;value:string|number;color:string}) { const colors:Record<string,string>={emerald:'text-emerald-600',rose:'text-rose-600',amber:'text-amber-600',blue:'text-orange-600',violet:'text-violet-600'}; return <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm"><div className={`text-3xl font-black ${colors[color]||colors.blue}`}>{value}</div><div className="mt-1 text-[11px] font-extrabold uppercase tracking-widest text-slate-400">{label}</div></div>; }
function ErrorBox({message,retry}:{message:string;retry:()=>void}) { return <div role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-white p-5 text-rose-700">{message}<button className="ml-3 font-bold underline" onClick={retry}>Retry</button></div>; }
function Empty({children}:{children:React.ReactNode}) { return <div className="grid min-h-40 place-items-center px-6 py-10 text-center text-sm text-slate-500">{children}</div>; }
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/40 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section role="dialog" aria-modal="true" aria-label={title} className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b px-6 py-4"><h2 className="text-lg font-extrabold text-slate-800">{title}</h2><button aria-label="Close" onClick={close} className="rounded-lg p-2 hover:bg-slate-100"><Icon name="close"/></button></header><div className="p-6">{children}</div></section></div>; }

export default function AdminAcademicsPartAPage(){ const {pathname}=useLocation(); const section=pathname.endsWith('/attendance')?'attendance':pathname.endsWith('/timetable')?'timetable':'leave'; return section==='attendance'?<AttendancePage/>:section==='timetable'?<TimetablePage/>:<LeavePage/>; }


function AttendancePage() {
  const navigate = useNavigate();
  const [batch, setBatch] = useState('');
  const [date, setDate] = useState('2026-10-25');
  const [activeTab, setActiveTab] = useState<'design-1'|'design-2'|'design-3'|'design-4'|'design-5'>('design-4');
  const [summaryData, setSummaryData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getLiveAttendanceSummary(batch, date);
      setSummaryData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load attendance summary');
    } finally {
      setLoading(false);
    }
  }, [batch, date]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = summaryData?.kpi || {
    totalClasses: 41,
    autoMarkedJoins: 111,
    avgAttendanceRate: 68,
    liveClassesToday: 3,
  };

  const dayRegister = summaryData?.dayRegister || {
    date: 'Sunday, 25 October 2026',
    dateStr: '2026-10-25',
    subjects: ['Physics', 'Chemistry', 'Maths', 'Biology'],
    rows: []
  };

  const subjectMatrix = summaryData?.subjectMatrix || [
    { id: '1', name: 'Physics', teacherName: 'Alok Sir', heldClasses: 14, presentJoins: 11, absentCount: 3, rate: 79 },
    { id: '2', name: 'Chemistry', teacherName: 'Dr. Verma', heldClasses: 12, presentJoins: 8, absentCount: 4, rate: 67 },
    { id: '3', name: 'Maths', teacherName: 'R.K. Gupta', heldClasses: 11, presentJoins: 9, absentCount: 2, rate: 82 },
    { id: '4', name: 'Biology', teacherName: 'Dr. Neha', heldClasses: 4, presentJoins: 2, absentCount: 2, rate: 50 },
  ];

  const liveClassFeed = summaryData?.liveClassFeed || [];
  const batchAnalytics = summaryData?.batchAnalytics || [
    { id: 'alpha', name: 'Batch ALPHA', studentCount: 4, classesHeld: 31, totalJoins: 37, rate: 66 },
    { id: 'beta', name: 'Batch BETA', studentCount: 1, classesHeld: 10, totalJoins: 8, rate: 80 },
  ];

  return (
    <div className="space-y-6 rounded-3xl bg-[#1c140e] p-6 text-white shadow-xl min-h-[85vh]">
      {loading && <div className="text-xs text-orange-400 animate-pulse font-semibold">Updating live attendance data...</div>}
      {error && <div className="text-xs text-rose-400 font-semibold">{error}</div>}
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Attendance</h1>
          <p className="mt-1 text-sm text-slate-300">
            Zoom join par automatic mark &bull; sirf dekhne aur analysis ke liye
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            className="rounded-xl border border-slate-700 bg-[#2b1f16] px-4 py-2.5 text-sm font-semibold text-white outline-none hover:border-orange-500 focus:border-orange-500"
          >
            <option value="">All Batches</option>
            <option value="e99885bc-17f1-4a0a-bf77-e7fb1cee36df">Batch ALPHA</option>
            <option value="03ac497f-f981-4926-bec9-f5680823631a">Batch BETA</option>
          </select>
          <a
            href="/student"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-bold text-white shadow-md hover:bg-orange-600 transition"
          >
            Student Portal Demo
          </a>
        </div>
      </div>

      {/* Design Pills / Tabs */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {[
          { key: 'design-1', label: 'Design 1: Subject Matrix' },
          { key: 'design-2', label: 'Design 2: Live Class Feed' },
          { key: 'design-3', label: 'Design 3: Batch Analytics' },
          { key: 'design-4', label: 'Design 4: Day Register' },
          { key: 'design-5', label: 'Design 5: Students and Detail' },
        ].map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                if (tab.key === 'design-5') {
                  navigate('/admin/students');
                } else {
                  setActiveTab(tab.key as any);
                }
              }}
              className={`rounded-full px-5 py-2 text-xs font-bold transition ${
                isActive
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20'
                  : 'bg-[#2b1f16] text-slate-300 hover:bg-[#38281d] hover:text-white border border-slate-850'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Sub-bar / Legend Card */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-[#251a13] px-6 py-4">
        <div className="font-bold text-white text-sm">
          Aaj: Sunday, 25 October 2026
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800/80 bg-emerald-950/70 px-3.5 py-1.5 font-bold text-emerald-400">
            Present = class join kiya
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-900/80 bg-rose-950/70 px-3.5 py-1.5 font-bold text-rose-400">
            Absent = class thi par join nahi kiya
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-3.5 py-1.5 font-semibold text-slate-400"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(255,255,255,0.06), rgba(255,255,255,0.06) 6px, transparent 6px, transparent 12px)',
            }}
          >
            Not enrolled = student ne ye subject liya hi nahi
          </span>
        </div>
      </div>

      {/* 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800/80 bg-[#251a13] p-5 shadow-sm">
          <div className="text-4xl font-black text-orange-500">{kpis.totalClasses}</div>
          <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
            Total classes
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-[#251a13] p-5 shadow-sm">
          <div className="text-4xl font-black text-orange-500">{kpis.autoMarkedJoins}</div>
          <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
            Auto-marked joins
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-[#251a13] p-5 shadow-sm">
          <div className="text-4xl font-black text-orange-500">{kpis.avgAttendanceRate}%</div>
          <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
            Average attendance
          </div>
        </div>
        <div className="rounded-2xl border border-slate-800/80 bg-[#251a13] p-5 shadow-sm">
          <div className="text-4xl font-black text-orange-500">{kpis.liveClassesToday}</div>
          <div className="mt-1 text-xs font-bold uppercase tracking-wider text-slate-400">
            Live classes aaj
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'design-4' && (
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#251a13] shadow-md">
          {/* Card Header with Date Picker */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
            <h2 className="text-base font-bold text-white">
              Day Register: {dayRegister.date}
            </h2>
            <select
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-slate-700 bg-[#2b1f16] px-3.5 py-1.5 text-xs font-bold text-white outline-none hover:border-orange-500"
            >
              <option value="2026-10-25">Sun, 25 Oct 2026</option>
              <option value="2026-10-24">Sat, 24 Oct 2026</option>
              <option value="2026-10-23">Fri, 23 Oct 2026</option>
              <option value="2026-10-22">Thu, 22 Oct 2026</option>
              <option value="2026-10-21">Wed, 21 Oct 2026</option>
              <option value="2026-10-20">Tue, 20 Oct 2026</option>
            </select>
          </div>

          {/* Day Register Table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="bg-[#1e150f] text-xs font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4">Student</th>
                  {dayRegister.subjects.map((sub: string) => (
                    <th key={sub} className="px-6 py-4 text-center">
                      {sub}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {dayRegister.rows.map((row: any) => (
                  <tr key={row.studentId} className="hover:bg-slate-900/30 transition">
                    <td className="px-6 py-4">
                      <div className="font-bold text-white">{row.name}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{row.batchName}</div>
                    </td>
                    {dayRegister.subjects.map((sub: string) => {
                      const item = row.subjects?.[sub] || { status: 'Not enrolled' };
                      if (item.status === 'Present') {
                        return (
                          <td key={sub} className="px-6 py-4 text-center">
                            <span className="inline-block rounded-full border border-emerald-700/60 bg-emerald-950/80 px-3.5 py-1 text-xs font-bold text-emerald-400">
                              Present
                            </span>
                            <span className="block text-[11px] text-slate-400 mt-1">
                              {item.joinTime || 'joined class'}
                            </span>
                          </td>
                        );
                      }
                      if (item.status === 'Absent') {
                        return (
                          <td key={sub} className="px-6 py-4 text-center">
                            <span className="inline-block rounded-full border border-rose-800/60 bg-rose-950/80 px-3.5 py-1 text-xs font-bold text-rose-400">
                              Absent
                            </span>
                            <span className="block text-[11px] text-slate-400 mt-1">
                              {item.classTime || 'class 10:30 AM'}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={sub} className="px-4 py-3 text-center">
                          <div
                            className="h-12 w-full rounded-xl flex items-center justify-center text-xs font-semibold text-slate-400/70 border border-slate-800/50"
                            style={{
                              backgroundImage:
                                'repeating-linear-gradient(45deg, rgba(255,255,255,0.04), rgba(255,255,255,0.04) 8px, transparent 8px, transparent 16px)',
                            }}
                          >
                            Not enrolled
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab 1: Subject Matrix */}
      {activeTab === 'design-1' && (
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#251a13] shadow-md">
          <div className="border-b border-slate-800 px-6 py-4">
            <h2 className="text-base font-bold text-white">Subject-wise Attendance Matrix</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#1e150f] text-xs font-bold text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-3.5">Subject</th>
                  <th className="px-6 py-3.5">Teacher</th>
                  <th className="px-6 py-3.5 text-center">Classes Held</th>
                  <th className="px-6 py-3.5 text-center">Present Joins</th>
                  <th className="px-6 py-3.5 text-center">Absent</th>
                  <th className="px-6 py-3.5">Attendance Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {subjectMatrix.map((sub: any) => (
                  <tr key={sub.id} className="hover:bg-slate-900/30 transition">
                    <td className="px-6 py-4 font-bold text-white">{sub.name}</td>
                    <td className="px-6 py-4 text-slate-300">{sub.teacherName}</td>
                    <td className="px-6 py-4 text-center font-semibold">{sub.heldClasses}</td>
                    <td className="px-6 py-4 text-center font-semibold text-emerald-400">{sub.presentJoins}</td>
                    <td className="px-6 py-4 text-center font-semibold text-rose-400">{sub.absentCount}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-32 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-orange-500 rounded-full" style={{ width: `${sub.rate}%` }} />
                        </div>
                        <span className="font-bold text-orange-400">{sub.rate}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tab 2: Live Class Feed */}
      {activeTab === 'design-2' && (
        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-[#251a13] shadow-md">
          <div className="border-b border-slate-800 px-6 py-4">
            <h2 className="text-base font-bold text-white">Live Class Zoom Feed (Auto-Joins)</h2>
          </div>
          <div className="divide-y divide-slate-800/80 max-h-[500px] overflow-y-auto">
            {liveClassFeed.length ? (
              liveClassFeed.map((feed: any) => (
                <div key={feed.id} className="flex items-center justify-between p-4 px-6 hover:bg-slate-900/30 transition">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/20 text-orange-400 font-bold text-xs">
                      {feed.studentName?.slice(0, 2).toUpperCase()}
                    </span>
                    <div>
                      <div className="font-bold text-white">{feed.studentName}</div>
                      <div className="text-xs text-slate-400">
                        {feed.batchName} &bull; {feed.subjectName} &bull; {feed.classTitle}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block rounded-full bg-emerald-950/80 border border-emerald-700/60 px-3 py-1 text-xs font-bold text-emerald-400">
                      ✓ Joined
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-1">
                      {feed.joinedAt ? new Date(feed.joinedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : ''}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 text-center text-sm text-slate-400">No joins recorded today yet.</div>
            )}
          </div>
        </section>
      )}

      {/* Tab 3: Batch Analytics */}
      {activeTab === 'design-3' && (
        <section className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {batchAnalytics.map((b: any) => (
              <div key={b.id} className="rounded-2xl border border-slate-800 bg-[#251a13] p-6 shadow-md">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-white">{b.name}</h3>
                  <span className="rounded-full bg-orange-500/20 border border-orange-500/30 px-3 py-1 text-xs font-bold text-orange-400">
                    {b.studentCount} Students
                  </span>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3 text-center border-t border-slate-800/80 pt-4">
                  <div>
                    <div className="text-2xl font-bold text-white">{b.classesHeld}</div>
                    <div className="text-[11px] text-slate-400 mt-1">Classes Held</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-emerald-400">{b.totalJoins}</div>
                    <div className="text-[11px] text-slate-400 mt-1">Total Joins</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-orange-500">{b.rate}%</div>
                    <div className="text-[11px] text-slate-400 mt-1">Attendance</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function HolidayModal({batchId,date,onClose,onSaved,batches=[],record}:{batchId:string;date:string;onClose:()=>void;onSaved:()=>void;batches?:any[];record?:any}){const [busy,setBusy]=useState(false),[error,setError]=useState('');return <Modal title={record?'Edit Holiday':'Add Holiday'} close={onClose}><form className="grid gap-4 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await createHoliday({id:record?.id,title:f.get('title'),startDate:f.get('from'),endDate:f.get('to'),batchId:f.get('batchId')||batchId,reason:f.get('reason')});onSaved();}catch(e){setError(e instanceof Error?e.message:'Holiday could not be saved.');}finally{setBusy(false);}}}><label className="text-sm font-bold">Holiday name<input required name="title" defaultValue={record?.title||''} className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">Batch<select name="batchId" defaultValue={record?.batchId||batchId} className={`${inputClass} mt-1`}><option value="">All batches</option>{batches.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className="text-sm font-bold">From<input required name="from" type="date" defaultValue={record?.startDate||date} className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">To<input required name="to" type="date" defaultValue={record?.endDate||date} className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold sm:col-span-2">Reason<input name="reason" defaultValue={record?.reason||''} className={`${inputClass} mt-1`}/></label>{error&&<p role="alert" className="text-sm text-rose-700 sm:col-span-2">{error}</p>}<div className="sm:col-span-2 flex justify-end gap-2"><button type="button" onClick={onClose} className={`${button} border`}>Cancel</button><button disabled={busy} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>{busy?'Saving…':record?'Save Holiday':'Add Holiday'}</button></div></form></Modal>;}

function TimetablePage(){
  const [lookups,setLookups]=useState<any>({batches:[],subjects:[],teachers:[]});
  const [data,setData]=useState<any>({classes:[],holidays:[],approvedStaffLeave:[],availability:[]});
  const [batch,setBatch]=useState(''),[teacher,setTeacher]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[modal,setModal]=useState(''),[editing,setEditing]=useState<any>(null),[matrix,setMatrix]=useState(false);
  const load=useCallback(async()=>{setLoading(!data.classes.length);setError('');try{const [l,d]=await Promise.all([timetableLookups(),getTimetable(batch,teacher)]);setLookups(l);setData(d);}catch(e){setError(e instanceof Error?e.message:'Timetable could not be loaded.');}},[batch,teacher]);
  useEffect(()=>{void load();},[load]);
  const currentDay=new Date().toLocaleDateString('en-US',{weekday:'long'}),hours=Array.from({length:14},(_,i)=>7+i),classes=data.classes||[];
  const save=async(record:any)=>{try{const result=await saveTimetableClass(record);setModal('');setEditing(null);await load();if(result.availabilityWarning)alert('Saved. This time falls outside the teacher’s saved availability.');}catch(e){setError(e instanceof Error?e.message:'Class could not be saved.');}};
  const remove=async(id:string)=>{if(!window.confirm('Delete this class?'))return;try{await deleteTimetableClass(id);await load();}catch(e){setError(e instanceof Error?e.message:'Class could not be deleted.');}};
  const dateInWeek=(day:string)=>{const d=new Date(),offset=(d.getDay()+6)%7;d.setDate(d.getDate()-offset+days.indexOf(day));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  return <div className="print:bg-white"><PageHeader title="Timetable" subtitle="Manage class schedules — conflicts are automatically prevented" actions={<><button className={`${button} border border-slate-300 bg-white text-slate-700 print:hidden`} onClick={()=>window.print()}><Icon name="print"/> Print PDF</button><button className={`${button} border border-slate-300 bg-white text-slate-700 print:hidden`} onClick={()=>setModal('substitute')}>♙ Substitutes</button><button className={`${button} border border-slate-300 bg-white text-slate-700 print:hidden`} onClick={()=>setModal('availability')}>◷ Availability</button><button className={`${button} border border-blue-300 bg-white text-orange-600 print:hidden`} onClick={()=>setMatrix(v=>!v)}><Icon name="grid"/> Matrix</button><button className={`${button} bg-orange-500 text-white hover:bg-orange-600 print:hidden`} onClick={()=>{setEditing(null);setModal('class');}}><Icon name="plus"/> Add Class</button></>}/>
  {error&&<ErrorBox message={error} retry={()=>void load()}/>}<section className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm print:hidden"><div className="flex flex-wrap items-center gap-2"><b className="mr-2 text-sm text-slate-600">Batch:</b><button onClick={()=>setBatch('')} className={`${button} rounded-full ${!batch?'bg-orange-500 text-white hover:bg-orange-600':'border border-slate-200 text-slate-700'}`}>All</button>{lookups.batches.map((b:any)=><button key={b.id} onClick={()=>setBatch(b.id)} className={`${button} rounded-full ${batch===b.id?'bg-orange-500 text-white hover:bg-orange-600':'border border-slate-200 text-slate-700'}`}>{b.name}</button>)}</div><label className="flex items-center gap-3 text-sm font-bold">Teacher:<select className={`${inputClass} w-56`} value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">— All Teachers —</option>{lookups.teachers.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></section>
  {!lookups.batches.length&&<div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Create batches first to schedule classes.</div>}
  <Panel title="▦  Weekly Schedule" action={<div className="flex flex-wrap gap-2">{Object.keys(typeColors).map(name=><span key={name} className={`rounded-full px-3 py-1 text-xs ${legendStyles[name]}`}>{name}</span>)}</div>}>
    <div className="overflow-x-auto"><div className="min-w-[1050px]"><div className="grid grid-cols-[64px_repeat(7,minmax(120px,1fr))] border-b bg-slate-50"><div/>{days.map(d=><div key={d} className={`p-3 text-center text-xs font-black uppercase ${d===currentDay?'bg-blue-50 text-orange-600':''}`}>{d.slice(0,3)}{d===currentDay&&<span className="mx-auto mt-1 block w-fit rounded-full bg-blue-600 px-2 py-0.5 text-[9px] text-white">TODAY</span>}</div>)}</div>
    {loading&&!classes.length?<div className="h-72 animate-pulse bg-slate-50"/>:hours.map(hour=><div key={hour} className="grid min-h-[94px] grid-cols-[64px_repeat(7,minmax(120px,1fr))] border-b last:border-0"><div className="p-3 text-xs font-semibold text-slate-400">{String(hour).padStart(2,'0')}:00</div>{days.map(day=>{const scheduleDate=dateInWeek(day),list=classes.filter((c:any)=>c.day===day&&Number(c.startTime?.slice(0,2))===hour&&(!c.dateFrom||c.dateFrom<=scheduleDate)&&(!c.dateTo||c.dateTo>=scheduleDate)),holiday=(data.holidays||[]).find((h:any)=>(!h.batchId||!batch||h.batchId===batch)&&(h.startDate||h.date)<=scheduleDate&&(h.endDate||h.date)>=scheduleDate),leave=(data.approvedStaffLeave||[]).find((l:any)=>(!teacher||l.staffKey===teacher)&&(!l.startDate||l.startDate<=scheduleDate)&&(!l.endDate||l.endDate>=scheduleDate));return <div key={day} className={`border-l border-slate-100 p-1.5 ${day===currentDay?'bg-blue-50/60':''}`}>{holiday&&<div className="mb-1 rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{holiday.title}</div>}{leave&&<div className="mb-1 rounded-lg bg-orange-100 px-2 py-1 text-[10px] text-orange-800">Approved leave</div>}{list.map((c:any)=><article key={c.id} className={`group mb-1 rounded-lg border-l-4 p-2 text-[11px] ${typeStyles[c.type]||typeStyles.Lecture}`}><div className="flex justify-between gap-1"><b className="truncate">{c.subjectName||c.title}</b><span className="hidden group-hover:flex print:hidden"><button aria-label="Edit class" onClick={()=>{setEditing(c);setModal('class');}}><Icon name="edit"/></button><button aria-label="Delete class" onClick={()=>void remove(c.id)}><Icon name="trash"/></button></span></div><p>{c.batchName} · {c.startTime}–{c.endTime}</p><p>{c.substituteName||c.teacherName}{c.room?` · ${c.room}`:''}</p></article>)}</div>;})}</div>)}
    {matrix&&<div className="border-t p-4"><h3 className="mb-3 font-bold">Teacher × class matrix</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{lookups.teachers.map((t:any)=><div key={t.id} className="rounded-xl border p-3"><b>{t.name}</b><p className="mt-2 text-xs text-slate-500">{classes.filter((c:any)=>c.staffKey===t.id).length} scheduled classes</p></div>)}</div></div>}{!classes.length&&<p className="py-5 text-center text-sm text-slate-400">No classes scheduled yet.</p>}</div></div></Panel>
  {modal==='class'&&<ClassModal record={editing} lookups={lookups} close={()=>{setModal('');setEditing(null);}} onSave={save}/ >}{modal==='availability'&&<AvailabilityModal lookups={lookups} close={()=>setModal('')} onSave={async r=>{try{await saveTeacherAvailability(r);setModal('');await load();}catch(e){setError(e instanceof Error?e.message:'Availability could not be saved.');}}}/ >}{modal==='substitute'&&<SubstituteModal lookups={lookups} classes={classes} close={()=>setModal('')} onSave={async r=>{try{await assignSubstitute(r.id,r.staffKey,r.date);setModal('');await load();}catch(e){setError(e instanceof Error?e.message:'Substitute could not be assigned.');}}}/ >}</div>;
}function ClassModal({record,lookups,close,onSave}:{record:any;lookups:any;close:()=>void;onSave:(r:any)=>void}){return <Modal title={record?'Edit Class':'Add Class'} close={close}><form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);onSave(Object.fromEntries(f.entries()));}}>{[['title','Class title',record?.title],['batchId','Batch',record?.batchId],['subjectId','Subject',record?.subjectId],['staffKey','Teacher',record?.staffKey],['type','Type',record?.type||'Lecture'],['day','Day',record?.day||'Monday'],['startTime','Start time',record?.startTime||'09:00'],['endTime','End time',record?.endTime||'10:00'],['room','Room',record?.room],['dateFrom','From date',record?.dateFrom],['dateTo','To date',record?.dateTo]].map(([name,label,value]:any)=><label key={name} className="text-xs font-bold uppercase text-slate-600">{label}{['batchId','subjectId','staffKey','type','day'].includes(name)?<select required={name!=='type'} name={name} defaultValue={value} className={`${inputClass} mt-1 normal-case`}>{(name==='batchId'?lookups.batches:name==='subjectId'?lookups.subjects:name==='staffKey'?lookups.teachers:name==='type'?['Lecture','Lab','Doubt','Test','Special'].map(x=>({id:x,name:x})):days.map(x=>({id:x,name:x}))).map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}</select>:<input name={name} type={name.toLowerCase().includes('date')?'date':name.toLowerCase().includes('time')?'time':'text'} defaultValue={value||''} className={`${inputClass} mt-1 normal-case`}/>}</label>)}<div className="col-span-full flex justify-end gap-2"><button type="button" onClick={close} className={`${button} border`}>Cancel</button><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Save Class</button></div></form></Modal>;}
function AvailabilityModal({lookups,close,onSave}:{lookups:any;close:()=>void;onSave:(r:any)=>void}){return <Modal title="Teacher Availability" close={close}><form className="grid gap-4 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();onSave(Object.fromEntries(new FormData(e.currentTarget).entries()));}}><label className="text-sm font-bold">Teacher<select name="staffKey" required className={`${inputClass} mt-1`}>{lookups.teachers.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="text-sm font-bold">Day<select name="day" className={`${inputClass} mt-1`}>{days.map(d=><option key={d}>{d}</option>)}</select></label><label className="text-sm font-bold">Available from<input name="startTime" type="time" required className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">Available until<input name="endTime" type="time" required className={`${inputClass} mt-1`}/></label><button className={`${button} col-span-full bg-orange-500 text-white hover:bg-orange-600`}>Save Availability</button></form></Modal>;}
function SubstituteModal({lookups,classes,close,onSave}:{lookups:any;classes:any[];close:()=>void;onSave:(r:any)=>void}){return <Modal title="Assign Substitute" close={close}><form className="grid gap-4" onSubmit={e=>{e.preventDefault();onSave(Object.fromEntries(new FormData(e.currentTarget).entries()));}}><label className="text-sm font-bold">Class<select name="id" required className={`${inputClass} mt-1`}>{classes.map(c=><option key={c.id} value={c.id}>{c.subjectName||c.title} · {c.day} {c.startTime}</option>)}</select></label><label className="text-sm font-bold">Substitute teacher<select name="staffKey" required className={`${inputClass} mt-1`}>{lookups.teachers.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="text-sm font-bold">Date<input name="date" type="date" defaultValue={today()} required className={`${inputClass} mt-1`}/></label><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Assign Substitute</button></form></Modal>;}

function LeavePage(){const [lookups,setLookups]=useState<any>({holidays:[],types:[],balances:[],students:[],staff:[]}),[data,setData]=useState<any>(null),[records,setRecords]=useState<any[]>([]),[status,setStatus]=useState(''),[role,setRole]=useState(''),[page,setPage]=useState(1),[error,setError]=useState(''),[loading,setLoading]=useState(true),[modal,setModal]=useState(''),[editingHoliday,setEditingHoliday]=useState<any>(null),[regularizations,setRegularizations]=useState(false),[regularStatus,setRegularStatus]=useState('');
  const hasLoaded=useRef(false);
  const load=useCallback(async()=>{setLoading(!hasLoaded.current);setError('');try{const [l,r]=await Promise.all([getLeaveLookups(),regularizations?getRegularizations(regularStatus):getLeaveRequests({page,status,role})]);setLookups(l);setData(r);setRecords(r.records||[]);hasLoaded.current=true;}catch(e){setError(e instanceof Error?e.message:'Leave data could not be loaded.');}},[page,status,role,regularizations,regularStatus]);useEffect(()=>{void load();},[load]);
 const act=async(id:string,s:string)=>{const note=s==='Rejected'?prompt('Optional admin note')||'':'';try{await reviewLeave(regularizations?'regularizations':'requests',id,s.toLowerCase(),note);await load();}catch(e){setError(e instanceof Error?e.message:'Request could not be updated.');}};
 const deleteRecord=async(section:'holidays'|'types'|'balances',id:string)=>{if(!confirm('Delete this record?'))return;try{await deleteLeaveRecord(section,id);await load();}catch(e){setError(e instanceof Error?e.message:'Could not delete record.');}};
 return <div><PageHeader title="Leave Management" subtitle="Approve leave requests and manage holiday calendar" actions={<><button className={`${button} border bg-white text-slate-700`} onClick={()=>setModal('balances')}>▤ Leave Balances</button><button className={`${button} border bg-white text-slate-700`} onClick={()=>{setRegularizations(v=>!v);setPage(1);}}>◷ Regularizations</button><button className={`${button} border bg-white text-slate-700`} onClick={()=>setModal('type')}><Icon name="plus"/> Leave Type</button><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`} onClick={()=>{setEditingHoliday(null);setModal('holiday');}}><Icon name="calendar"/> Add Holiday</button></>}/>{error&&<ErrorBox message={error} retry={()=>void load()}/>}<div className="mb-6 grid max-w-2xl gap-4 sm:grid-cols-2"><Stat label="Pending" value={regularizations?records.filter(r=>r.status?.toLowerCase()==='pending').length:data?.pending||0} color="amber"/><Stat label="Approved" value={regularizations?records.filter(r=>r.status?.toLowerCase()==='approved').length:data?.approved||0} color="emerald"/></div><div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_400px]"><div><section className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-orange-200 bg-white p-4 shadow-sm">{regularizations&&<select value={regularStatus} onChange={e=>setRegularStatus(e.target.value)} className={`${inputClass} max-w-48`}><option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>}{!regularizations&&<><select value={status} onChange={e=>setStatus(e.target.value)} className={`${inputClass} max-w-48`}><option value="">All Status</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select><select value={role} onChange={e=>setRole(e.target.value)} className={`${inputClass} max-w-48`}><option value="">All Roles</option><option value="student">Students</option><option value="staff">Staff</option></select></>}<button onClick={()=>void load()} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Filter</button><button onClick={()=>{setStatus('');setRole('');setRegularStatus('');setPage(1);}} className={`${button} border border-slate-300 text-slate-600`}>Clear</button></section><Panel title={regularizations?'Attendance Regularizations':'Leave Requests'}><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="bg-blue-50 text-[11px] font-black uppercase text-slate-700"><tr>{(regularizations?['Name','Date','Correction','Reason','Status','Actions']:['Name','Type','Dates','Days','Reason','Status','Actions']).map(x=><th key={x} className="px-4 py-3">{x}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{records.map(r=><tr key={r.id} className="text-sm"><td className="px-4 py-4 font-bold">{r.personName||r.studentName||r.name||'Account'}<small className="block text-xs font-normal text-slate-400">{r.role||''}</small></td>{regularizations?<><td className="px-4 py-4">{dateLabel(r.date)}</td><td className="px-4 py-4">{r.correctedStatus||'—'}</td></>:<><td className="px-4 py-4">{r.typeName||r.leaveType||r.type||'Leave'}</td><td className="px-4 py-4">{dateLabel(r.startDate||r.date)}{r.endDate&&r.endDate!==r.startDate?` – ${dateLabel(r.endDate)}`:''}</td><td className="px-4 py-4">{r.days??'—'}</td></>}<td className="max-w-52 px-4 py-4 text-slate-500">{r.reason||'—'}</td><td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{r.status||'Pending'}</span></td><td className="px-4 py-4">{String(r.status||'pending').toLowerCase()==='pending'?<div className="flex gap-1"><button onClick={()=>void act(r.id,'approved')} className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">Approve</button><button onClick={()=>void act(r.id,'rejected')} className="rounded-lg bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700">Reject</button></div>:<span className="text-xs text-slate-400">Reviewed</span>}</td></tr>)}</tbody></table>{!records.length&&<Empty>{loading?'Loading records…':regularizations?'No regularization requests found.':'No leave requests found'}</Empty>}</div>{!regularizations&&<div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span>{data?.total||0} requests</span><div className="flex items-center gap-3"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {data?.pages||1}</span><button disabled={page>=(data?.pages||1)} onClick={()=>setPage(p=>p+1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button></div></div>}</Panel></div><aside className="grid gap-5"><Panel title="Holiday Calendar">{lookups.holidays.length?<ul className="divide-y">{lookups.holidays.map((h:any)=><li key={h.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm"><span><b>{h.title}</b><small className="block text-slate-500">{dateLabel(h.startDate)}{h.endDate!==h.startDate?` – ${dateLabel(h.endDate)}`:''}</small></span><span className="flex gap-2"><button aria-label="Edit holiday" onClick={()=>{setEditingHoliday(h);setModal('holiday');}} className="text-blue-600"><Icon name="edit"/></button><button aria-label="Delete holiday" onClick={()=>void deleteRecord('holidays',h.id)} className="text-rose-600"><Icon name="trash"/></button></span></li>)}</ul>:<Empty>No holidays added</Empty>}</Panel><Panel title="Leave Types" action={<button onClick={()=>setModal('balance')} className="rounded-xl border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-orange-600">Ⓢ Add Balance</button>}>{lookups.types.length?<ul className="divide-y">{lookups.types.map((t:any)=><li key={t.id} className="flex justify-between px-4 py-3 text-sm"><span><b>{t.name}</b><small className="block text-slate-500">{t.daysPerYear} days/year · {t.appliesTo}</small></span><button aria-label="Delete leave type" onClick={()=>void deleteRecord('types',t.id)} className="text-rose-600"><Icon name="trash"/></button></li>)}</ul>:<Empty>No leave types defined yet. Use the “Leave Type” button above to add one.</Empty>}</Panel></aside></div>{modal==='holiday'&&<HolidayModal batchId="" date={today()} record={editingHoliday||undefined} onClose={()=>setModal('')} onSaved={async()=>{setModal('');setEditingHoliday(null);await load();}}/>}{modal==='type'&&<LeaveTypeModal close={()=>setModal('')} saved={load}/ >}{modal==='balance'&&<BalanceModal lookups={lookups} close={()=>setModal('')} saved={load}/ >}{modal==='balances'&&<Modal title="Leave Balances" close={()=>setModal('')}><div className="mb-4 flex justify-end"><button onClick={()=>setModal('balance')} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Add Balance</button></div>{lookups.balances.length?<div className="divide-y">{lookups.balances.map((b:any)=><div key={b.id} className="flex justify-between py-3 text-sm"><span><b>{b.name}</b><small className="block text-slate-500">{b.role} · {lookups.types.find((t:any)=>t.id===b.typeId)?.name||'Leave'}</small></span><span>{b.days} allotted · {Math.max(0,Number(b.days)-records.filter(r=>r.personKey===b.personKey&&r.typeId===b.typeId&&r.status==='Approved').reduce((n,r)=>n+Number(r.days||0),0))} remaining <button onClick={()=>void deleteRecord('balances',b.id)} className="ml-2 text-rose-600"><Icon name="close"/></button></span></div>)}</div>:<Empty>No leave balances added</Empty>}</Modal>}</div>;
}
function LeaveTypeModal({close,saved}:{close:()=>void;saved:()=>Promise<void>}){return <Modal title="Add Leave Type" close={close}><form className="grid gap-4 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await createLeaveType({name:f.get('name'),code:f.get('code'),daysPerYear:Number(f.get('days')),appliesTo:f.get('appliesTo'),paid:f.get('paid')==='on'});await saved();close();}catch{/* parent remains available for retry */}}}><label className="text-sm font-bold">Name<input name="name" required className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">Code<input name="code" required className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">Days per year<input name="days" type="number" min="0" max="365" required className={`${inputClass} mt-1`}/></label><label className="text-sm font-bold">Applies to<select name="appliesTo" className={`${inputClass} mt-1`}><option value="student">Students</option><option value="staff">Staff</option><option value="both">Both</option></select></label><label className="flex items-center gap-2 text-sm"><input name="paid" type="checkbox"/> Paid leave</label><div className="col-span-full flex justify-end gap-2"><button type="button" onClick={close} className={`${button} border`}>Cancel</button><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Save Leave Type</button></div></form></Modal>;}
function BalanceModal({lookups,close,saved}:{lookups:any;close:()=>void;saved:()=>Promise<void>}){const [role,setRole]=useState('student');const people=role==='student'?lookups.students:lookups.staff;return <Modal title="Add Leave Balance" close={close}><form className="grid gap-4 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const person=people.find((p:any)=>p.id===f.get('personKey'));const type=lookups.types.find((t:any)=>t.id===f.get('typeId'));try{await createLeaveBalance({personKey:person?.id,typeId:type?.id,days:Number(f.get('days')),name:person?.name,role});await saved();close();}catch{/* parent remains available for retry */}}}><label className="text-sm font-bold">Role<select value={role} onChange={e=>setRole(e.target.value)} className={`${inputClass} mt-1`}><option value="student">Student</option><option value="staff">Staff</option></select></label><label className="text-sm font-bold">Person<select name="personKey" required className={`${inputClass} mt-1`}>{people.map((p:any)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="text-sm font-bold">Leave Type<select name="typeId" required className={`${inputClass} mt-1`}>{lookups.types.map((t:any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="text-sm font-bold">Days<input name="days" type="number" min="0" max="365" required className={`${inputClass} mt-1`}/></label><div className="col-span-full flex justify-end gap-2"><button type="button" onClick={close} className={`${button} border`}>Cancel</button><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Save Balance</button></div></form></Modal>;}
