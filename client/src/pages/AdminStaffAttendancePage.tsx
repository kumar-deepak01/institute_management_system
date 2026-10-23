import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import { payrollDownload, staffAttendanceGet, staffAttendanceSave, type StaffAttendanceData, type StaffAttendanceDay, type StaffAttendanceStatus, type StaffAttendancePerson } from '../services/payroll';

type View = 'daily' | 'monthly' | 'analytics';
type Draft = StaffAttendanceDay;
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const statuses: Array<{ value: StaffAttendanceStatus; label: string; short: string; tone: string }> = [
  { value: 'present', label: 'Present', short: 'P', tone: 'emerald' },
  { value: 'late', label: 'Late', short: 'L', tone: 'amber' },
  { value: 'half_day', label: 'Half Day', short: '½', tone: 'cyan' },
  { value: 'leave', label: 'Leave', short: 'LV', tone: 'blue' },
  { value: 'absent', label: 'Absent', short: 'A', tone: 'rose' },
  { value: 'holiday', label: 'Holiday', short: 'H', tone: 'slate' },
];
const toneClasses: Record<string, string> = { emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700', amber: 'border-amber-200 bg-amber-50 text-amber-800', cyan: 'border-cyan-200 bg-cyan-50 text-cyan-800', blue: 'border-blue-200 bg-blue-50 text-blue-700', rose: 'border-rose-200 bg-rose-50 text-rose-700', slate: 'border-slate-200 bg-slate-100 text-slate-600' };
const todayLocal = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; };
const keyFor = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const minutesText = (value: number) => `${Math.floor(Math.max(0, value) / 60)}h ${Math.max(0, value) % 60}m`;
const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';
function attendanceDraft(person: StaffAttendancePerson, date: string): Draft { return person.days[date] || { status: 'absent', checkIn: '', checkOut: '', minutes: 0, overtimeMinutes: 0, recordStatus: '' }; }
function Card({ label, value, icon, tone }: { label: string; value: string | number; icon: string; tone: string }) {
  return <article className="flex min-w-0 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone}`}><AdminIcon name={icon} className="h-6 w-6"/></span><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{value}</p></div></article>;
}

export default function AdminStaffAttendancePage() {
  const navigate = useNavigate();
  const initialDate = todayLocal();
  const [view, setView] = useState<View>('daily');
  const [date, setDate] = useState(initialDate);
  const [month, setMonth] = useState(Number(initialDate.slice(5,7)));
  const [year, setYear] = useState(Number(initialDate.slice(0,4)));
  const [data, setData] = useState<StaffAttendanceData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await staffAttendanceGet(month, year); setData(result); setDrafts({}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff attendance could not be loaded.'); }
    finally { setLoading(false); }
  }, [month, year]);
  useEffect(() => { void load(); }, [load]);

  const visibleStaff = data?.staff || [];
  const dayStatusCount = useMemo(() => visibleStaff.reduce((counts, person) => {
    const status = (drafts[person.id] || attendanceDraft(person, date)).status;
    counts[status] += 1;
    return counts;
  }, { present: 0, late: 0, half_day: 0, leave: 0, absent: 0, holiday: 0 }), [date, drafts, visibleStaff]);

  function updateDraft(staffId: string, patch: Partial<Draft>) {
    const person = visibleStaff.find(item => item.id === staffId);
    if (!person) return;
    setDrafts(current => ({ ...current, [staffId]: { ...attendanceDraft(person, date), ...current[staffId], ...patch } }));
  }
  function setAll(status: StaffAttendanceStatus) {
    setDrafts(Object.fromEntries(visibleStaff.map(person => [person.id, { ...attendanceDraft(person, date), status }])));
  }
  async function save() {
    if (!data || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await staffAttendanceSave(date, visibleStaff.map(person => {
        const row = drafts[person.id] || attendanceDraft(person, date);
        return { staffId: person.id, status: row.status, checkIn: row.checkIn, checkOut: row.checkOut, overtimeMinutes: Number(row.overtimeMinutes || 0) };
      }));
      setNotice('Staff attendance saved and payroll records updated.');
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff attendance could not be saved.'); }
    finally { setSaving(false); }
  }
  async function report() {
    try { await payrollDownload(`/staff-attendance/report.csv?month=${month}&year=${year}`, `staff-attendance-${year}-${String(month).padStart(2,'0')}.csv`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Attendance report could not be downloaded.'); }
  }
  function changeDate(value: string) {
    if (!value) return;
    setDate(value); setMonth(Number(value.slice(5,7))); setYear(Number(value.slice(0,4)));
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const formattedDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return <main className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-3xl font-black text-blue-600">{view === 'daily' ? 'Staff Attendance' : view === 'monthly' ? 'Monthly Attendance' : 'Staff Monthly Analytics'}</h2><p className="mt-1 text-slate-500">{view === 'daily' ? formattedDate : `${months[month-1]} ${year} · ${data?.workdays || 0} working days`}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {view !== 'daily' && <button className={`${buttonBase} border-slate-300 bg-white text-slate-600`} onClick={() => setView('daily')}><AdminIcon name="calendar" className="h-4 w-4"/>Daily View</button>}
        {view === 'daily' && <button className={`${buttonBase} border-slate-300 bg-white text-slate-600`} onClick={() => setView('monthly')}>Monthly View</button>}
        {view !== 'analytics' && <button className={`${buttonBase} border-blue-300 bg-white text-blue-700`} onClick={report}><AdminIcon name="report" className="h-4 w-4"/>Report</button>}
        {view !== 'analytics' && <input aria-label="Attendance date" type="date" value={date} onChange={event => changeDate(event.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"/>}
        {view === 'analytics' && <><select aria-label="Month" value={month} onChange={event => setMonth(Number(event.target.value))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{months.map((name,index)=><option key={name} value={index+1}>{name}</option>)}</select><select aria-label="Year" value={year} onChange={event => setYear(Number(event.target.value))} className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">{Array.from({length:9},(_,index)=>new Date().getFullYear()-4+index).map(value=><option key={value}>{value}</option>)}</select><button className={`${buttonBase} border-blue-600 bg-blue-600 text-white`} onClick={() => void load()}>Apply</button><button className={`${buttonBase} border-emerald-700 bg-emerald-600 text-white`} onClick={() => navigate('/admin/payroll')}><AdminIcon name="payment" className="h-4 w-4"/>Run Payroll</button></>}
      </div>
    </header>

    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}<button className="float-right font-bold" onClick={() => setNotice('')}>Dismiss</button></div>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">{error}<button className="font-bold underline" onClick={() => void load()}>Retry</button></div>}
    {data?.schemaPending && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Staff attendance storage is not available yet. Apply the staff payroll migration, then reload.</div>}

    {view === 'daily' && <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card label="PRESENT" value={dayStatusCount.present} icon="verified" tone="bg-emerald-50 text-emerald-600"/><Card label="ABSENT" value={dayStatusCount.absent} icon="eventOff" tone="bg-rose-50 text-rose-600"/><Card label="LATE" value={dayStatusCount.late} icon="clock" tone="bg-amber-50 text-amber-600"/><Card label="ATTENDANCE RATE" value={`${visibleStaff.length ? Math.round((dayStatusCount.present + dayStatusCount.late + dayStatusCount.half_day * 0.5) * 100 / visibleStaff.length) : 0}%`} icon="chart" tone="bg-blue-50 text-blue-600"/>
      </section>
      <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-100 px-5 py-4"><h3 className="flex items-center gap-2 font-extrabold text-slate-800"><AdminIcon name="calendar" className="h-5 w-5 text-blue-600"/>All Staff <span className="font-normal text-slate-500">— {formattedDate}</span></h3><div className="flex flex-wrap gap-2 text-sm font-bold"><span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-800">{dayStatusCount.present} Present</span><span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-rose-800">{dayStatusCount.absent} Absent</span><span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-800">{dayStatusCount.late} Late</span></div></div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3"><button className={`${buttonBase} border-emerald-600 bg-emerald-600 text-white`} onClick={() => setAll('present')}>✓ All Present</button><button className={`${buttonBase} border-rose-600 bg-rose-600 text-white`} onClick={() => setAll('absent')}>× All Absent</button><button className={`${buttonBase} border-amber-300 bg-amber-100 text-amber-900`} onClick={() => setAll('holiday')}>All Holiday</button><span className="ml-auto text-xs text-slate-400">Set each staff member’s status and punch times, then save once.</span></div>
        {loading && !data ? <div className="grid gap-3 p-5 md:grid-cols-2"><div className="h-24 animate-pulse rounded-xl bg-slate-100"/><div className="h-24 animate-pulse rounded-xl bg-slate-100"/></div> : visibleStaff.length === 0 ? <div className="p-12 text-center"><p className="font-bold text-slate-700">No active staff members found.</p><p className="mt-1 text-sm text-slate-500">Add staff in Staff Management to start recording attendance.</p></div> : <div className="divide-y divide-slate-100">{visibleStaff.map(person => {
          const row = drafts[person.id] || attendanceDraft(person, date);
          return <div key={person.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(180px,1.3fr)_minmax(120px,.8fr)_minmax(130px,.8fr)_minmax(130px,.8fr)_minmax(120px,.7fr)_minmax(95px,.5fr)_minmax(110px,.6fr)] lg:items-center">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 font-black text-blue-700">{person.name.slice(0,1).toUpperCase() || 'S'}</span><div className="min-w-0"><b className="block truncate">{person.name || 'Unnamed staff'}</b><span className="block truncate text-xs text-slate-400">{person.employeeId || person.email || '—'}</span></div></div>
            <div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{person.type}</span><span className="ml-2 text-xs text-slate-500">{person.employmentType || '—'}</span></div>
            <label className="block"><span className="mb-1 block text-[10px] font-black uppercase text-slate-400">Status</span><select aria-label={`Attendance status: ${person.name}`} value={row.status} onChange={event => updateDraft(person.id,{status:event.target.value as StaffAttendanceStatus})} className={`w-full rounded-lg border px-3 py-2 text-sm font-semibold ${toneClasses[statuses.find(item=>item.value===row.status)?.tone || 'slate']}`}>{statuses.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <label className="block"><span className="mb-1 block text-[10px] font-black uppercase text-slate-400">Check In</span><input aria-label={`Check in: ${person.name}`} type="time" value={row.checkIn} onChange={event=>updateDraft(person.id,{checkIn:event.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
            <label className="block"><span className="mb-1 block text-[10px] font-black uppercase text-slate-400">Check Out</span><input aria-label={`Check out: ${person.name}`} type="time" value={row.checkOut} onChange={event=>updateDraft(person.id,{checkOut:event.target.value})} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
            <div><span className="mb-1 block text-[10px] font-black uppercase text-slate-400">Biometric</span><span className="text-sm text-slate-400">—</span></div>
            <label className="block"><span className="mb-1 block text-[10px] font-black uppercase text-slate-400">Overtime (min)</span><input aria-label={`Overtime minutes: ${person.name}`} type="number" min="0" max="1440" value={row.overtimeMinutes} onChange={event=>updateDraft(person.id,{overtimeMinutes:Number(event.target.value)})} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
          </div>;
        })}</div>}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4"><button disabled={saving || visibleStaff.length===0 || data?.schemaPending} onClick={() => void save()} className={`${buttonBase} border-blue-700 bg-blue-600 text-white shadow-sm`}><AdminIcon name="download" className="h-4 w-4"/>{saving?'Saving…':'Save Attendance'}</button>{loading&&data&&<span role="status" className="text-xs text-slate-400">Refreshing month…</span>}<button className="ml-auto text-sm font-bold text-blue-700" onClick={() => setView('analytics')}>Open staff monthly analytics →</button></div>
      </section>
    </>}

    {view === 'monthly' && <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-100 px-5 py-4"><h3 className="font-extrabold text-blue-800">Monthly Attendance — {months[month-1]} {year}</h3><p className="text-sm text-slate-500">Select a date to open daily marking.</p></div>{visibleStaff.length===0?<p className="p-12 text-center text-slate-500">{loading?'Loading staff attendance…':'No active staff members found.'}</p>:<div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-xs"><thead className="bg-blue-50 text-[10px] font-black uppercase text-blue-700"><tr><th className="sticky left-0 z-10 min-w-52 bg-blue-50 px-4 py-3">Staff Member</th>{Array.from({length:daysInMonth},(_,i)=><th key={i+1} className="min-w-9 px-1 py-3 text-center">{i+1}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleStaff.map(person=><tr key={person.id}><td className="sticky left-0 z-10 bg-white px-4 py-3"><button className="text-left" onClick={()=>setView('analytics')}><b className="block">{person.name}</b><span className="text-slate-400">{person.type}</span></button></td>{Array.from({length:daysInMonth},(_,i)=>{const day=i+1;const key=keyFor(year,month,day);const entry=person.days[key];const status=entry?.status;const display=statuses.find(item=>item.value===status);return <td key={day} className="px-1 py-2 text-center"><button title={`${person.name} · ${key} · ${display?.label||'Unmarked'}${entry?.checkIn?` · ${entry.checkIn}`:''}`} onClick={()=>{changeDate(key);setView('daily');}} className={`mx-auto grid h-7 w-7 place-items-center rounded-md text-[10px] font-black ${display?toneClasses[display.tone]:'bg-slate-50 text-slate-300'}`}>{display?.short||'·'}</button></td>;})}</tr>)}</tbody></table></div>}<div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">{statuses.map(item=><span key={item.value} className={`rounded-full border px-2.5 py-1 text-xs font-bold ${toneClasses[item.tone]}`}>{item.short} {item.label}</span>)}</div></section>}

    {view === 'analytics' && <>
      <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">{months[month-1]} {year}</span><span className="rounded-full bg-slate-600 px-3 py-1 text-xs font-bold text-white">{data?.workdays || 0} Working Days</span><button className="ml-auto text-sm font-bold text-blue-700" onClick={report}><AdminIcon name="report" className="mr-1 inline h-4 w-4"/>Export Report</button></div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Card label="Total Staff" value={data?.stats.totalStaff || 0} icon="staff" tone="bg-blue-50 text-blue-600"/><Card label="Avg Attendance" value={`${data?.stats.avgAttendance || 0}%`} icon="verified" tone="bg-emerald-50 text-emerald-600"/><Card label="Late Check-Ins" value={data?.stats.lateCheckIns || 0} icon="clock" tone="bg-amber-50 text-amber-600"/><Card label="Overtime Hours" value={`${Number(data?.stats.overtimeHours || 0).toFixed(1)}h`} icon="chart" tone="bg-cyan-50 text-cyan-600"/></section>
      <section className="overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-100 px-5 py-4"><h3 className="text-lg font-extrabold text-blue-800">Staff Analytics Ledger</h3><p className="text-xs text-slate-500">Open View Logs to expand daily punch details.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1300px] text-left text-sm"><thead className="bg-blue-50 text-[10px] font-black uppercase text-blue-700"><tr>{['Staff Member','Type','Present','Late','Half Day','Leave','Absent','Holiday','Attendance Rate','Working Hours','Biometric','Actions'].map(label=><th key={label} className="px-3 py-3">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleStaff.map(person=>{
        const rows=Object.values(person.days);const counts={present:0,late:0,half_day:0,leave:0,absent:0,holiday:0};let minutes=0;for(const row of rows){if(row.status in counts)counts[row.status as keyof typeof counts]+=1;minutes+=Number(row.minutes||0);}const rate=data?.workdays?Math.round((counts.present+counts.late+counts.half_day*.5)*100/data.workdays):0;const isExpanded=expanded.includes(person.id);
        return <Fragment key={person.id}><tr className="hover:bg-blue-50/40"><td className="px-3 py-3"><b className="block">{person.name}</b><span className="text-xs text-slate-400">{person.employeeId||person.email}</span></td><td className="px-3 py-3"><span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">{person.employmentType||person.type}</span></td><td className="px-3 py-3 font-bold text-emerald-700">{counts.present}</td><td className="px-3 py-3 font-bold text-amber-600">{counts.late}</td><td className="px-3 py-3 font-bold text-cyan-700">{counts.half_day}</td><td className="px-3 py-3 text-blue-700">{counts.leave}</td><td className="px-3 py-3 text-rose-700">{counts.absent}</td><td className="px-3 py-3">{counts.holiday}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"><span className="block h-full bg-rose-500" style={{width:`${Math.min(100,rate)}%`}}/></span><b>{rate}%</b></div></td><td className="px-3 py-3">{(minutes/60).toFixed(1)} hrs</td><td className="px-3 py-3 text-slate-400">—</td><td className="px-3 py-3"><div className="flex gap-1"><button className="rounded-lg border px-2.5 py-1.5 text-xs font-bold text-slate-700" onClick={()=>setExpanded(current=>isExpanded?current.filter(id=>id!==person.id):[...current,person.id])}>{isExpanded?'Hide Logs':'View Logs'}</button><button className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700" onClick={()=>navigate('/admin/payroll')}>Setup</button></div></td></tr>{isExpanded&&<tr><td colSpan={12} className="bg-slate-50 p-4"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{Array.from({length:daysInMonth},(_,i)=>{const day=i+1,key=keyFor(year,month,day),entry=person.days[key];if(!entry)return null;const display=statuses.find(item=>item.value===entry.status);return <article key={key} className="rounded-xl border border-slate-200 bg-white p-3 text-xs"><div className="flex items-center justify-between"><b>{new Date(`${key}T00:00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</b><span className={`rounded-full border px-2 py-0.5 font-bold ${toneClasses[display?.tone||'slate']}`}>{display?.label||entry.status}</span></div><p className="mt-2 text-slate-500">Check In: <b className="text-slate-700">{entry.checkIn||'—'}</b></p><p className="text-slate-500">Check Out: <b className="text-slate-700">{entry.checkOut||'—'}</b></p><p className="text-slate-500">Working: <b className="text-slate-700">{minutesText(entry.minutes)}</b> · Overtime: <b className="text-slate-700">{minutesText(entry.overtimeMinutes)}</b></p></article>;})}</div></td></tr>}</Fragment>;
      })}{!loading&&visibleStaff.length===0&&<tr><td colSpan={12} className="p-12 text-center text-slate-500">No staff records available.</td></tr>}</tbody></table></div></section>
    </>}
  </main>;
}
