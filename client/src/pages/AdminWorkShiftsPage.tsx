import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import { shiftTemplateCreate, shiftTemplateDelete, shiftsAssign, workShiftsGet, type ShiftTemplate, type WorkShiftsData } from '../services/staffInsights';

type Tab = 'templates' | 'assign';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';
const input = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-blue-100';
const initialTemplate = { name: '', code: '', workStart: '09:00', workEnd: '17:00', lateAfterMinutes: 15, halfDayAfterMinutes: 240, halfDayMinHours: 3, fullDayMinHours: 6 };

export default function AdminWorkShiftsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<WorkShiftsData | null>(null);
  const [tab, setTab] = useState<Tab>('templates');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(initialTemplate);
  const [selectedShift, setSelectedShift] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const result = await workShiftsGet(); setData(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Work shifts could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const templates = data?.templates || [];
  const staff = data?.staff || [];
  const assignedByKey = useMemo(() => new Map((data?.assignments || []).map(item => [item.staffKey, item])), [data]);
  const filteredStaff = useMemo(() => staff.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase())), [staff, search]);
  const shiftNames = useMemo(() => new Map(templates.map(item => [item.id, item.name])), [templates]);

  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const result = await shiftTemplateCreate({ ...form, code: form.code.trim().toUpperCase() });
      setForm(initialTemplate); setShowForm(false); setNotice('Shift template created.');
      await load(); setSelectedShift(result.template.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The shift template could not be saved.'); }
    finally { setSaving(false); }
  }
  async function deleteTemplate(template: ShiftTemplate) {
    if (!window.confirm(`Delete the ${template.name} shift template and its assignments?`)) return;
    setError(''); setNotice('');
    try { await shiftTemplateDelete(template.id); setNotice('Shift template deleted.'); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The shift template could not be deleted.'); }
  }
  async function saveAssignments() {
    setSaving(true); setError(''); setNotice('');
    try { const result = await shiftsAssign(selectedShift, selectedStaff); setNotice(`Shift assigned to ${result.assigned} staff member${result.assigned === 1 ? '' : 's'}.`); setSelectedStaff([]); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff shift assignments could not be saved.'); }
    finally { setSaving(false); }
  }
  function toggleStaff(key: string) { setSelectedStaff(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]); }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">HR &amp; Staff</p><h2 className="mt-1 text-3xl font-black text-orange-600">Staff Work Shifts &amp; Time Slots</h2><p className="mt-1 text-sm text-slate-500">Define work shift schedules and bulk-assign time slots to faculty and staff members.</p></div>
      <div className="flex gap-2"><button className={`${button} border-slate-300 bg-white text-slate-700`} onClick={() => navigate('/admin/staff')}><span aria-hidden="true">←</span>Back to Staff List</button><button className={`${button} border-blue-600 bg-orange-500 text-white hover:bg-orange-600 shadow-md shadow-blue-200`} onClick={() => { setTab('templates'); setShowForm(true); }}><span aria-hidden="true">＋</span>Create Time Slot</button></div>
    </div>
    {error && <div role="alert" className="flex justify-between rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700">{error}<button className="font-bold underline" onClick={() => void load()}>Retry</button></div>}
    {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</div>}
    <div className="flex flex-wrap gap-2 border-b border-slate-200">
      <button onClick={() => setTab('templates')} className={`${button} rounded-b-none ${tab === 'templates' ? 'border-blue-600 bg-orange-500 text-white hover:bg-orange-600' : 'border-transparent bg-white text-slate-600'}`}>Shift Templates ({templates.length})</button>
      <button onClick={() => setTab('assign')} className={`${button} rounded-b-none ${tab === 'assign' ? 'border-blue-600 bg-orange-500 text-white hover:bg-orange-600' : 'border-transparent bg-white text-slate-600'}`}>Bulk Shift Assignment</button>
    </div>
    {tab === 'templates' && <>
      {showForm && <form onSubmit={event => void saveTemplate(event)} className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between"><h3 className="text-lg font-extrabold">Create Shift Template</h3><button type="button" aria-label="Close" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><AdminIcon name="close" className="h-5 w-5"/></button></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-slate-600">SHIFT NAME *<input required maxLength={100} className={`${input} mt-2`} placeholder="e.g. Morning Shift" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
          <label className="text-xs font-bold text-slate-600">SHIFT CODE<input maxLength={30} className={`${input} mt-2`} placeholder="e.g. MORNING" value={form.code} onChange={event => setForm({ ...form, code: event.target.value })}/></label>
          <label className="text-xs font-bold text-slate-600">WORK START *<input required type="time" className={`${input} mt-2`} value={form.workStart} onChange={event => setForm({ ...form, workStart: event.target.value })}/></label>
          <label className="text-xs font-bold text-slate-600">WORK END *<input required type="time" className={`${input} mt-2`} value={form.workEnd} onChange={event => setForm({ ...form, workEnd: event.target.value })}/></label>
          <label className="text-xs font-bold text-slate-600">LATE AFTER (MINS)<input type="number" min="0" max="1440" className={`${input} mt-2`} value={form.lateAfterMinutes} onChange={event => setForm({ ...form, lateAfterMinutes: Number(event.target.value) })}/></label>
          <label className="text-xs font-bold text-slate-600">HALF-DAY AFTER (MINS)<input type="number" min="0" max="1440" className={`${input} mt-2`} value={form.halfDayAfterMinutes} onChange={event => setForm({ ...form, halfDayAfterMinutes: Number(event.target.value) })}/></label>
          <label className="text-xs font-bold text-slate-600">HALF-DAY MIN (HOURS)<input type="number" min="0" max="24" step="0.25" className={`${input} mt-2`} value={form.halfDayMinHours} onChange={event => setForm({ ...form, halfDayMinHours: Number(event.target.value) })}/><span className="mt-1 block font-normal text-slate-500">Below this worked time counts as half-day.</span></label>
          <label className="text-xs font-bold text-slate-600">FULL-DAY MIN (HOURS)<input type="number" min="0" max="24" step="0.25" className={`${input} mt-2`} value={form.fullDayMinHours} onChange={event => setForm({ ...form, fullDayMinHours: Number(event.target.value) })}/><span className="mt-1 block font-normal text-slate-500">At or above this time counts as full present.</span></label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" className={`${button} border-slate-300 bg-white text-slate-700`} onClick={() => setShowForm(false)}>Cancel</button><button disabled={saving} className={`${button} border-blue-600 bg-orange-500 text-white hover:bg-orange-600`}>Save Shift Template</button></div>
      </form>}
      {loading && !data ? <div className="grid min-h-56 place-items-center rounded-2xl border bg-white text-slate-500">Loading work shifts…</div> : templates.length === 0 ? <div className="grid min-h-72 place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-5 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-orange-600"><AdminIcon name="clock" className="h-7 w-7"/></span><h3 className="mt-4 text-lg font-extrabold">No Work Shift Time Slots Created</h3><p className="mt-1 text-sm text-slate-500">Create a shift template to define staff working hours.</p><button className={`${button} mt-4 border-blue-600 bg-orange-500 text-white hover:bg-orange-600`} onClick={() => setShowForm(true)}><span aria-hidden="true">＋</span>Create Time Slot</button></div></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{templates.map(template => <article key={template.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex justify-between gap-3"><div><h3 className="text-lg font-extrabold">{template.name}</h3><p className="mt-1 text-xs font-bold tracking-wider text-orange-600">{template.code || 'SHIFT'}</p></div><button aria-label={`Delete ${template.name}`} onClick={() => void deleteTemplate(template)} className="h-9 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600">Delete</button></div><div className="mt-5 flex items-center justify-between rounded-xl bg-slate-50 p-4"><div><p className="text-[10px] font-bold text-slate-400">WORK START</p><p className="mt-1 text-lg font-black">{template.workStart}</p></div><span aria-hidden="true" className="text-slate-400">→</span><div className="text-right"><p className="text-[10px] font-bold text-slate-400">WORK END</p><p className="mt-1 text-lg font-black">{template.workEnd}</p></div></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-600"><p>Late after <b>{template.lateAfterMinutes} min</b></p><p>Half-day after <b>{template.halfDayAfterMinutes} min</b></p><p>Half-day min <b>{template.halfDayMinHours} h</b></p><p>Full-day min <b>{template.fullDayMinHours} h</b></p></div><p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Assigned to {data?.assignments.filter(item => item.shiftId === template.id).length || 0} staff</p></article>)}</div>}
    </>}
    {tab === 'assign' && <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-gradient-to-r from-orange-100/70 to-orange-50/50 p-5"><h3 className="text-lg font-extrabold">Bulk Shift Assignment</h3><p className="mt-1 text-sm text-slate-500">Choose a work shift template, then select the staff members for that time slot.</p></div>
      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(220px,0.8fr)_1.2fr]">
        <div><label className="text-xs font-bold text-slate-600">WORK SHIFT TEMPLATE<select className={`${input} mt-2`} value={selectedShift} onChange={event => setSelectedShift(event.target.value)}><option value="">Choose a work shift template</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name} ({template.workStart}–{template.workEnd})</option>)}</select></label>{selectedShift && <div className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-blue-900"><b>{shiftNames.get(selectedShift)}</b><p className="mt-1">{templates.find(item => item.id === selectedShift)?.workStart} – {templates.find(item => item.id === selectedShift)?.workEnd}</p></div>}</div>
        <div><div className="flex flex-wrap items-center justify-between gap-3"><label className="min-w-[200px] flex-1"><span className="sr-only">Search staff</span><input className={input} placeholder="Search by name or email" value={search} onChange={event => setSearch(event.target.value)}/></label><div className="flex gap-2"><button className={`${button} border-slate-300 bg-white px-3 text-xs`} onClick={() => setSelectedStaff(filteredStaff.map(person => person.staffKey))}>Select All Available</button><button className={`${button} border-slate-300 bg-white px-3 text-xs`} onClick={() => setSelectedStaff([])}>Deselect All</button></div></div><div className="mt-3 max-h-80 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-200">{filteredStaff.map(person => <label key={person.staffKey} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-slate-50"><input type="checkbox" disabled={!selectedShift} checked={selectedStaff.includes(person.staffKey)} onChange={() => toggleStaff(person.staffKey)} className="h-4 w-4 rounded border-slate-300 text-orange-600"/><span className="min-w-0 flex-1"><b className="block truncate text-sm">{person.name}</b><span className="text-xs text-slate-500">{person.email}</span></span><span className="text-xs text-slate-500">{person.role || person.staffType}</span></label>)}{!filteredStaff.length && <p className="p-8 text-center text-sm text-slate-500">No active staff members found.</p>}</div><p className="mt-2 text-xs text-slate-500">{selectedStaff.length} selected · {selectedStaff.filter(key => assignedByKey.get(key)?.shiftId === selectedShift).length} already assigned to this shift</p></div>
      </div>
      {!templates.length && <p className="mx-5 mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Choose a work shift template first. Create one in the Shift Templates tab.</p>}
      <div className="flex justify-end border-t border-slate-200 bg-slate-50 p-4"><button disabled={saving || !selectedShift || !selectedStaff.length} onClick={() => void saveAssignments()} className={`${button} border-blue-600 bg-orange-500 text-white hover:bg-orange-600`}><AdminIcon name="check" className="h-4 w-4"/>Save Shift Assignments</button></div>
    </section>}
  </div>;
}
