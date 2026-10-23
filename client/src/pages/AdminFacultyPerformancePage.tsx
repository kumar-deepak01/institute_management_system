import { useCallback, useEffect, useState } from 'react';
import AdminIcon from '../components/AdminIcon';
import { facultyPerformanceGet, type FacultyPerformanceData } from '../services/staffInsights';

const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

function Metric({ label, value, tone = 'text-slate-900' }: { label: string; value: string | number; tone?: string }) {
  return <div className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className={`mt-1 text-lg font-black ${tone}`}>{value}</p></div>;
}

export default function AdminFacultyPerformancePage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [batchId, setBatchId] = useState('');
  const [data, setData] = useState<FacultyPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await facultyPerformanceGet(month, year, batchId)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Faculty performance could not be loaded.'); }
    finally { setLoading(false); }
  }, [month, year, batchId]);
  useEffect(() => { void load(); }, []);

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">HR &amp; Staff</p><h2 className="mt-1 text-3xl font-black text-blue-600">Faculty Performance</h2><p className="mt-1 text-sm text-slate-500">Data-driven insights into teaching effectiveness</p></div><div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600"><AdminIcon name="calendar" className="h-4 w-4 text-blue-600"/>{months[month - 1]} {year}</div></div>
    {error && <div role="alert" className="flex justify-between rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">{error}<button className="font-bold underline" onClick={() => void load()}>Retry</button></div>}
    <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <label className="min-w-40 flex-1 text-xs font-bold text-slate-600">PERIOD<select value={month} onChange={event => setMonth(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500">{months.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
      <label className="min-w-28 text-xs font-bold text-slate-600">YEAR<select value={year} onChange={event => setYear(Number(event.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500">{Array.from({ length: 7 }, (_, index) => now.getFullYear() - 3 + index).map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="min-w-52 flex-1 text-xs font-bold text-slate-600">BATCH<select value={batchId} onChange={event => setBatchId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm font-medium text-slate-800 outline-none focus:border-blue-500"><option value="">All Batches</option>{data?.batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</select></label>
      <button onClick={() => void load()} disabled={loading} className={`${button} border-blue-600 bg-blue-600 text-white shadow-md shadow-blue-200`}><AdminIcon name="calendar" className="h-4 w-4"/>View</button>
    </section>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[['Faculty', data?.summary.faculty ?? 0, 'staff', 'bg-blue-50 text-blue-600'], ['Average Score', `${data?.summary.averageScore ?? 0}/100`, 'chart', 'bg-emerald-50 text-emerald-600'], ['Period', `${months[month - 1]} ${year}`, 'calendar', 'bg-amber-50 text-amber-600'], ['Batch Scope', batchId ? data?.batches.find(item => item.id === batchId)?.name || 'Selected batch' : 'All Batches', 'briefcase', 'bg-violet-50 text-violet-600']].map(([label, value, icon, tone]) => <article key={String(label)} className="flex min-w-0 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${tone}`}><AdminIcon name={String(icon)} className="h-6 w-6"/></span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 truncate text-xl font-black text-slate-900">{value}</p></div></article>)}
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-indigo-50 px-5 py-4"><div><h3 className="text-lg font-extrabold text-blue-800">Teaching Effectiveness</h3><p className="mt-0.5 text-xs text-slate-500">Faculty scores for {months[month - 1]} {year}</p></div><span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">{data?.records.length || 0} faculty</span></div>
      {loading && !data ? <div className="space-y-3 p-5">{[0,1,2].map(item => <div key={item} className="h-24 animate-pulse rounded-xl bg-slate-100"/>)}</div> : !data?.records.length ? <div className="grid min-h-64 place-items-center px-6 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><AdminIcon name="chart" className="h-7 w-7"/></span><h4 className="mt-4 font-extrabold">No faculty performance records</h4><p className="mt-1 text-sm text-slate-500">Teaching activity and exam results will appear here when available.</p></div></div> : <div className="divide-y divide-slate-100">{data.records.map((person, index) => <article key={person.staffKey} className="p-5">
        <div className="flex flex-wrap items-center gap-4"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-sm font-black text-white">{index < 3 ? ['🥇','🥈','🥉'][index] : (person.name || '?').split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase()}</div><div className="min-w-48 flex-1"><h4 className="font-extrabold text-slate-900">{person.name}</h4><p className="mt-0.5 text-xs text-slate-500">{person.staffType || 'Faculty'} · {person.email}</p></div><div className="min-w-40 text-right"><span className="text-2xl font-black text-blue-600">{person.performanceScore}</span><span className="text-sm font-semibold text-slate-400"> / 100</span></div></div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full transition-all ${person.performanceScore >= 75 ? 'bg-emerald-500' : person.performanceScore >= 45 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{ width: `${Math.max(0, Math.min(100, person.performanceScore))}%` }}/></div>
        <div className="mt-4 grid grid-cols-2 gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-3 xl:grid-cols-5"><Metric label="Avg Score" value={`${person.averageStudentScore}%`} tone="text-indigo-700"/><Metric label="Classes" value={person.classesConducted}/><Metric label="HW Assigned" value={person.homeworkAssigned}/><Metric label="HW Completion" value={`${person.homeworkCompletion}%`} tone="text-emerald-700"/><Metric label="Doubts Answered" value={person.doubtsAnswered}/></div>
      </article>)}</div>}
    </section>
    <aside className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-xs leading-5 text-slate-600 sm:p-5"><h3 className="font-extrabold text-blue-900">How the performance score is calculated</h3><p className="mt-1">40% average student exam score in the faculty member’s batches, 30% classes conducted (5 points per approved class, capped at 30), and 30% student engagement (2 points per answered doubt, capped at 30). Homework assigned and completion are shown as separate teaching indicators.</p></aside>
  </div>;
}
