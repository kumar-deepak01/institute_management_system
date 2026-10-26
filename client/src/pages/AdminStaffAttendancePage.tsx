import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminIcon from '../components/AdminIcon';
import {
  payrollDownload,
  staffAttendanceGet,
  fetchStaffAttendanceDayRegister,
  overrideStaffAttendance,
  fetchStaffAttendanceTeacherView,
  type StaffAttendanceData,
  type DayRegisterData,
  type DayRegisterTeacherRecord,
  type TeacherViewData
} from '../services/payroll';

type Tab = 'day_register' | 'teacher_view';
type HeaderView = 'tabs' | 'monthly';

const months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const buttonBase = 'inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === 'present' || s === 'taken') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300';
  }
  if (s === 'late') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300';
  }
  if (s === 'absent' || s === 'missed') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-300';
  }
  if (s === 'upcoming') {
    return 'border-orange-200 bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:border-orange-800 dark:text-orange-300';
  }
  if (s === 'holiday') {
    return 'border-purple-200 bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:border-purple-800 dark:text-purple-300';
  }
  return 'border-slate-200 bg-slate-100 text-slate-600 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-400';
}

function KpiCard({ label, value, subtext }: { label: string; value: string | number; subtext?: string }) {
  return (
    <article className="flex min-w-0 flex-col justify-between rounded-2xl border border-orange-100 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <p className="text-3xl font-black text-orange-600 dark:text-orange-500">{value}</p>
      <div className="mt-2">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">{label}</p>
        {subtext && <p className="mt-0.5 text-xs text-slate-400 dark:text-stone-500">{subtext}</p>}
      </div>
    </article>
  );
}

export default function AdminStaffAttendancePage() {
  // Tab & View Navigation
  const [activeTab, setActiveTab] = useState<Tab>('day_register');
  const [headerView, setHeaderView] = useState<HeaderView>('tabs');

  // Shared state
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // -------------------- Day Register State --------------------
  const [dayRegisterDate, setDayRegisterDate] = useState<string>('');
  const [dayRegisterData, setDayRegisterData] = useState<DayRegisterData | null>(null);
  const [dayRegisterLoading, setDayRegisterLoading] = useState(false);

  // Edit Attendance Modal State
  const [editingTeacher, setEditingTeacher] = useState<DayRegisterTeacherRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>('present');
  const [editCheckIn, setEditCheckIn] = useState<string>('');
  const [editCheckOut, setEditCheckOut] = useState<string>('');
  const [editReason, setEditReason] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // -------------------- Teacher View State --------------------
  const [teacherViewData, setTeacherViewData] = useState<TeacherViewData | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [teacherSearchTerm, setTeacherSearchTerm] = useState<string>('');
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>('');
  const [teacherViewLoading, setTeacherViewLoading] = useState<boolean>(false);

  // -------------------- Legacy Monthly View State --------------------
  const [legacyData, setLegacyData] = useState<StaffAttendanceData | null>(null);
  const [legacyMonth, setLegacyMonth] = useState(new Date().getMonth() + 1);
  const [legacyYear, setLegacyYear] = useState(new Date().getFullYear());
  const [legacyLoading, setLegacyLoading] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(current => (current === msg ? '' : current));
    }, 3500);
  }, []);

  // 1. Load Day Register
  const loadDayRegister = useCallback(async (date?: string) => {
    setDayRegisterLoading(true);
    setError('');
    try {
      const res = await fetchStaffAttendanceDayRegister(date);
      setDayRegisterData(res);
      setDayRegisterDate(res.date);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load day register.');
    } finally {
      setDayRegisterLoading(false);
    }
  }, []);

  // 2. Load Teacher View
  const loadTeacherView = useCallback(async (staffId?: string, month?: string) => {
    setTeacherViewLoading(true);
    setError('');
    try {
      const res = await fetchStaffAttendanceTeacherView(staffId, month);
      setTeacherViewData(res);
      if (res.selectedTeacher) {
        setSelectedStaffId(res.selectedTeacher.id);
      }
      setSelectedCalendarDate(''); // Reset selected day on teacher/month change
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teacher view.');
    } finally {
      setTeacherViewLoading(false);
    }
  }, []);

  // 3. Load Legacy Monthly View
  const loadLegacyMonthly = useCallback(async () => {
    setLegacyLoading(true);
    try {
      const res = await staffAttendanceGet(legacyMonth, legacyYear);
      setLegacyData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load monthly attendance.');
    } finally {
      setLegacyLoading(false);
    }
  }, [legacyMonth, legacyYear]);

  // Initial loads
  useEffect(() => {
    void loadDayRegister();
  }, [loadDayRegister]);

  useEffect(() => {
    if (activeTab === 'teacher_view' && !teacherViewData) {
      void loadTeacherView(selectedStaffId, selectedMonth);
    }
  }, [activeTab, teacherViewData, loadTeacherView, selectedStaffId, selectedMonth]);

  useEffect(() => {
    if (headerView === 'monthly') {
      void loadLegacyMonthly();
    }
  }, [headerView, loadLegacyMonthly]);

  // Handle Edit Click
  const handleOpenEdit = (rec: DayRegisterTeacherRecord) => {
    setEditingTeacher(rec);
    setEditStatus(rec.status === 'No class' ? 'present' : rec.status.toLowerCase());
    setEditCheckIn(rec.checkIn && rec.checkIn !== '—' ? rec.checkIn : '');
    setEditCheckOut(rec.checkOut && rec.checkOut !== '—' ? rec.checkOut : '');
    setEditReason(rec.editReason || '');
  };

  // Handle Save Edit
  const handleSaveEdit = async () => {
    if (!editingTeacher || !dayRegisterDate || savingEdit) return;
    setSavingEdit(true);
    try {
      await overrideStaffAttendance({
        staffId: editingTeacher.id,
        date: dayRegisterDate,
        status: editStatus,
        checkIn: editCheckIn,
        checkOut: editCheckOut,
        reason: editReason
      });
      showToast('Attendance updated ✓');
      setEditingTeacher(null);
      await loadDayRegister(dayRegisterDate);
      if (activeTab === 'teacher_view') {
        await loadTeacherView(selectedStaffId, selectedMonth);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update attendance.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Handle CSV Report Download
  const handleDownloadReport = async () => {
    try {
      const ym = selectedMonth.split('-');
      await payrollDownload(
        `/staff-attendance/report.csv?month=${Number(ym[1])}&year=${Number(ym[0])}`,
        `staff-attendance-${selectedMonth}.csv`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Report download failed.');
    }
  };

  // Filtered Teacher list for teacher view selector
  const filteredTeachers = useMemo(() => {
    const list = teacherViewData?.teachersList || [];
    if (!teacherSearchTerm) return list;
    const term = teacherSearchTerm.toLowerCase();
    return list.filter(t => t.name.toLowerCase().includes(term) || t.employeeId.toLowerCase().includes(term));
  }, [teacherViewData?.teachersList, teacherSearchTerm]);

  // Filtered Class Log in Teacher View (if calendar day is selected)
  const filteredClassLog = useMemo(() => {
    const logs = teacherViewData?.classLog || [];
    if (!selectedCalendarDate) return logs;
    return logs.filter(item => item.rawDate === selectedCalendarDate);
  }, [teacherViewData?.classLog, selectedCalendarDate]);

  return (
    <main className="space-y-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-8 left-1/2 z-50 -translate-x-1/2 animate-bounce rounded-2xl border border-emerald-400 bg-emerald-600 px-6 py-3.5 text-base font-bold text-white shadow-2xl">
          {toastMessage}
        </div>
      )}

      {/* Page Header (Preserved with Report and Monthly View buttons) */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black text-orange-600 dark:text-orange-500">
            {headerView === 'monthly' ? 'Monthly Attendance' : 'Staff Attendance'}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-stone-400">
            {headerView === 'monthly'
              ? `${months[legacyMonth - 1]} ${legacyYear}`
              : 'Marked automatically when teachers take a scheduled class. View, analysis and admin edit only.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {headerView === 'monthly' ? (
            <button
              className={`${buttonBase} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200`}
              onClick={() => setHeaderView('tabs')}
            >
              <AdminIcon name="calendar" className="h-4 w-4" />
              Daily View
            </button>
          ) : (
            <button
              className={`${buttonBase} border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200`}
              onClick={() => setHeaderView('monthly')}
            >
              Monthly View
            </button>
          )}

          <button
            className={`${buttonBase} border-orange-200 bg-white text-orange-600 hover:bg-orange-50 dark:border-orange-900/50 dark:bg-stone-900 dark:text-orange-400`}
            onClick={handleDownloadReport}
          >
            <AdminIcon name="report" className="h-4 w-4" />
            Report
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300">
          <span>{error}</span>
          <button className="underline font-bold" onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {/* Legacy Monthly View */}
      {headerView === 'monthly' && (
        <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-[#FFF7ED] px-5 py-4 dark:border-stone-800 dark:bg-stone-800/60">
            <h3 className="font-extrabold text-slate-800 dark:text-white">
              Monthly Attendance — {months[legacyMonth - 1]} {legacyYear}
            </h3>
            <div className="flex gap-2">
              <select
                aria-label="Legacy Month"
                value={legacyMonth}
                onChange={e => setLegacyMonth(Number(e.target.value))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-white"
              >
                {months.map((m, idx) => (
                  <option key={m} value={idx + 1}>{m}</option>
                ))}
              </select>
              <select
                aria-label="Legacy Year"
                value={legacyYear}
                onChange={e => setLegacyYear(Number(e.target.value))}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-800 dark:text-white"
              >
                {[legacyYear - 1, legacyYear, legacyYear + 1].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="p-6">
            {legacyLoading ? (
              <p className="text-center text-slate-400">Loading monthly attendance…</p>
            ) : !legacyData?.staff?.length ? (
              <p className="text-center text-slate-500">No staff attendance found for this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                    <tr>
                      <th className="sticky left-0 z-10 min-w-52 bg-[#FFF7ED] px-4 py-3 dark:bg-stone-800">Staff Member</th>
                      {Array.from({ length: new Date(legacyYear, legacyMonth, 0).getDate() }, (_, i) => (
                        <th key={i + 1} className="min-w-9 px-1 py-3 text-center">{i + 1}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                    {legacyData.staff.map(person => (
                      <tr key={person.id}>
                        <td className="sticky left-0 z-10 bg-white px-4 py-3 dark:bg-stone-900">
                          <b className="block text-slate-900 dark:text-white">{person.name}</b>
                          <span className="text-slate-400 text-[11px]">{person.type}</span>
                        </td>
                        {Array.from({ length: new Date(legacyYear, legacyMonth, 0).getDate() }, (_, i) => {
                          const day = i + 1;
                          const key = `${legacyYear}-${String(legacyMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const entry = person.days[key];
                          const s = entry?.status || 'unmarked';
                          const initial = s === 'present' ? 'P' : s === 'late' ? 'L' : s === 'absent' ? 'A' : '·';
                          return (
                            <td key={day} className="px-1 py-2 text-center">
                              <span className={`mx-auto grid h-7 w-7 place-items-center rounded-md text-[10px] font-black ${statusBadge(s)}`}>
                                {initial}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main Tabs (Pill shape, orange active) */}
      {headerView === 'tabs' && (
        <>
          <div className="flex items-center gap-2 border-b border-orange-100 pb-2 dark:border-stone-800">
            <button
              onClick={() => setActiveTab('day_register')}
              className={`rounded-full px-5 py-2 text-sm font-bold transition-all ${
                activeTab === 'day_register'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              Day Register
            </button>
            <button
              onClick={() => setActiveTab('teacher_view')}
              className={`rounded-full px-5 py-2 text-sm font-bold transition-all ${
                activeTab === 'teacher_view'
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white text-slate-600 hover:bg-orange-50 dark:bg-stone-900 dark:text-stone-300 dark:hover:bg-stone-800'
              }`}
            >
              Teacher View
            </button>
          </div>

          {/* ==================== TAB A: DAY REGISTER ==================== */}
          {activeTab === 'day_register' && (
            <div className="space-y-6">
              {/* Top Legend Card */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-orange-100 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="flex items-center gap-2">
                  <span className="font-extrabold text-slate-900 dark:text-white">Today:</span>
                  <span className="font-bold text-orange-600 dark:text-orange-400">
                    {dayRegisterData?.todayDate || 'Monday, 26 October 2026'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-emerald-800 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    Present: took the class on time
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-amber-800 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-500" />
                    Late: joined 8+ min late
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-1 text-rose-800 dark:bg-rose-950/60 dark:border-rose-800 dark:text-rose-300">
                    <span className="h-2 w-2 rounded-full bg-rose-500" />
                    Absent: class held, did not join
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full border border-orange-300 bg-orange-50 px-3 py-1 text-orange-800 dark:bg-orange-950/60 dark:border-orange-800 dark:text-orange-300">
                    <span className="h-2 w-2 rounded-full bg-orange-500" />
                    Upcoming: class not started
                  </span>
                </div>
              </div>

              {/* 6 KPI Cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                <KpiCard label="Teachers Scheduled" value={dayRegisterData?.kpis.teachersScheduled ?? 0} />
                <KpiCard label="Present" value={dayRegisterData?.kpis.present ?? 0} />
                <KpiCard label="Late" value={dayRegisterData?.kpis.late ?? 0} />
                <KpiCard label="Absent" value={dayRegisterData?.kpis.absent ?? 0} />
                <KpiCard label="Classes Taken" value={dayRegisterData?.kpis.classesTaken || '0/0'} />
                <KpiCard label="Teaching Hours" value={dayRegisterData?.kpis.teachingHours || '0.0 h'} />
              </div>

              {/* Main Day Register Table Card */}
              <div className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                {/* Header Strip (#FFF7ED) */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-[#FFF7ED] px-6 py-4 dark:border-stone-800 dark:bg-stone-800/60">
                  <h3 className="font-extrabold text-slate-800 dark:text-white">
                    Who took classes: {dayRegisterData?.formattedDate || 'Monday, 26 October 2026'}
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 dark:text-stone-400">Date:</span>
                    <select
                      aria-label="Select date for day register"
                      value={dayRegisterDate}
                      onChange={e => {
                        const val = e.target.value;
                        setDayRegisterDate(val);
                        void loadDayRegister(val);
                      }}
                      className="rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                    >
                      {(dayRegisterData?.availableDates || []).map(d => (
                        <option key={d.date} value={d.date}>{d.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Table Content */}
                {dayRegisterLoading ? (
                  <div className="p-12 text-center text-slate-400">Loading daily attendance records…</div>
                ) : !dayRegisterData?.records?.length ? (
                  <div className="p-12 text-center text-slate-500">No staff roster records available.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left text-sm">
                      <thead className="border-b border-orange-100 bg-[#FFF7ED]/50 text-[10px] font-black uppercase tracking-wider text-orange-700 dark:border-stone-800 dark:bg-stone-800/40 dark:text-orange-400">
                        <tr>
                          <th className="px-5 py-3.5">Teacher</th>
                          <th className="px-5 py-3.5">Classes</th>
                          <th className="px-4 py-3.5">Check In</th>
                          <th className="px-4 py-3.5">Check Out</th>
                          <th className="px-4 py-3.5">Hours</th>
                          <th className="px-4 py-3.5">Status</th>
                          <th className="px-4 py-3.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                        {dayRegisterData.records.map(record => {
                          const initial = (record.name || 'T').charAt(0).toUpperCase();
                          return (
                            <tr key={record.id} className="hover:bg-orange-50/30 dark:hover:bg-stone-800/30">
                              {/* Teacher info */}
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 font-black text-orange-600 dark:bg-stone-800 dark:text-orange-400">
                                    {initial}
                                  </div>
                                  <div>
                                    <p className="font-bold text-slate-900 dark:text-white">{record.name}</p>
                                    <p className="text-xs text-slate-400 dark:text-stone-500">
                                      {record.employeeId} · <span className="capitalize">{record.employmentModel}</span>
                                    </p>
                                  </div>
                                </div>
                              </td>

                              {/* Classes */}
                              <td className="px-5 py-4">
                                {!record.hasClasses ? (
                                  <span className="text-xs text-slate-400 dark:text-stone-500 italic">No class scheduled</span>
                                ) : (
                                  <div className="space-y-1.5">
                                    {record.classes.map((cls, idx) => (
                                      <div key={cls.id || idx} className="text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-slate-800 dark:text-stone-200">
                                            {cls.batch} • {cls.subject}
                                          </span>
                                          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                            cls.status === 'marked'
                                              ? (cls.joinStatus === 'Late' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300')
                                              : cls.status === 'missed'
                                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300'
                                              : 'bg-orange-100 text-orange-800 dark:bg-orange-950/70 dark:text-orange-300'
                                          }`}>
                                            {cls.statusText}
                                          </span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>

                              {/* Check in */}
                              <td className="px-4 py-4 text-xs font-semibold text-slate-700 dark:text-stone-300">
                                {record.checkIn || '—'}
                              </td>

                              {/* Check out */}
                              <td className="px-4 py-4 text-xs font-semibold text-slate-700 dark:text-stone-300">
                                {record.checkOut || '—'}
                              </td>

                              {/* Hours */}
                              <td className="px-4 py-4 text-xs font-bold text-slate-900 dark:text-white">
                                {record.hours || '—'}
                              </td>

                              {/* Status */}
                              <td className="px-4 py-4">
                                <div className="space-y-1">
                                  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${statusBadge(record.status)}`}>
                                    {record.status}
                                  </span>
                                  {record.isEdited && (
                                    <div
                                      title={`Edited by ${record.editedBy || 'Admin'}${record.editReason ? ` • ${record.editReason}` : ''}`}
                                      className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1 cursor-help"
                                    >
                                      <span>✎</span> Edited by admin
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* Action */}
                              <td className="px-4 py-4 text-right">
                                <button
                                  onClick={() => handleOpenEdit(record)}
                                  className="rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-orange-600 shadow-sm transition hover:bg-orange-50 dark:border-stone-700 dark:bg-stone-800 dark:text-orange-400 dark:hover:bg-stone-700"
                                >
                                  Edit
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ==================== TAB B: TEACHER VIEW ==================== */}
          {activeTab === 'teacher_view' && (
            <div className="space-y-6">
              {/* Top Card: Teacher Search & Profile Banner */}
              <div className="rounded-2xl border border-orange-100 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-orange-100 pb-5 dark:border-stone-800">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-slate-700 dark:text-stone-300">Select Teacher:</span>
                    <input
                      type="text"
                      placeholder="Search by name or Emp ID..."
                      value={teacherSearchTerm}
                      onChange={e => setTeacherSearchTerm(e.target.value)}
                      className="w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                    />
                    <select
                      aria-label="Teacher Selector"
                      value={selectedStaffId}
                      onChange={e => {
                        const val = e.target.value;
                        setSelectedStaffId(val);
                        void loadTeacherView(val, selectedMonth);
                      }}
                      className="rounded-xl border border-orange-200 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-sm dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                    >
                      {filteredTeachers.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.employeeId})</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500 dark:text-stone-400">Month:</span>
                    <input
                      aria-label="Select month for teacher view"
                      type="month"
                      value={selectedMonth}
                      onChange={e => {
                        const val = e.target.value;
                        setSelectedMonth(val);
                        void loadTeacherView(selectedStaffId, val);
                      }}
                      className="rounded-xl border border-orange-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-sm dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                    />
                  </div>
                </div>

                {/* Teacher Profile Card */}
                {teacherViewData?.selectedTeacher && (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-black text-orange-600 dark:bg-stone-800 dark:text-orange-400">
                        {teacherViewData.selectedTeacher.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-xl font-black text-slate-900 dark:text-white">
                            {teacherViewData.selectedTeacher.name}
                          </h4>
                          <span className="rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-700 dark:border-stone-700 dark:bg-stone-800 dark:text-orange-300">
                            {teacherViewData.selectedTeacher.employeeId}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-stone-400">
                          {teacherViewData.selectedTeacher.staffType} · <span className="capitalize">{teacherViewData.selectedTeacher.employmentModel}</span> · {teacherViewData.selectedTeacher.email || '—'}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-orange-100 bg-[#FFF7ED] px-4 py-2 text-right dark:border-stone-800 dark:bg-stone-800/60">
                      <span className="text-[10px] font-black uppercase text-orange-700 dark:text-orange-400">Selected Month</span>
                      <p className="font-bold text-slate-800 dark:text-white">
                        {months[Number(selectedMonth.split('-')[1]) - 1]} {selectedMonth.split('-')[0]}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* 6 KPI Cards for Teacher */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                <KpiCard label="Classes Taken" value={teacherViewData?.kpis.classesTaken || '0/0'} />
                <KpiCard label="Teaching Hours" value={teacherViewData?.kpis.teachingHours || '0.0 h'} />
                <KpiCard label="Present Days" value={teacherViewData?.kpis.presentDays ?? 0} />
                <KpiCard label="Late Days" value={teacherViewData?.kpis.lateDays ?? 0} />
                <KpiCard label="Absent Days" value={teacherViewData?.kpis.absentDays ?? 0} />
                <KpiCard label="Attendance %" value={teacherViewData?.kpis.attendanceRate || '0%'} />
              </div>

              {/* 2-Column Grid: Left Calendar + Right Batch/Subject Summary */}
              <div className="grid gap-6 lg:grid-cols-12">
                {/* Left: Date-wise Calendar (7 Cols) */}
                <div className="lg:col-span-7 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <div className="flex items-center justify-between border-b border-orange-100 pb-3 dark:border-stone-800">
                    <h4 className="font-extrabold text-slate-800 dark:text-white">
                      Date-wise Calendar — {months[Number(selectedMonth.split('-')[1]) - 1]} {selectedMonth.split('-')[0]}
                    </h4>
                    <span className="text-xs text-slate-400">Click a day to filter class log</span>
                  </div>

                  {teacherViewLoading ? (
                    <div className="p-8 text-center text-slate-400">Loading calendar…</div>
                  ) : (
                    <div className="mt-4">
                      {/* Day Headers: Mon-Sun */}
                      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-stone-500">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(w => (
                          <div key={w} className="py-1">{w}</div>
                        ))}
                      </div>

                      {/* Month Grid */}
                      <div className="mt-2 grid grid-cols-7 gap-1.5">
                        {/* Offset blanks for first day of month */}
                        {(() => {
                          if (!teacherViewData?.calendar?.length) return null;
                          const firstDayDate = new Date(`${teacherViewData.calendar[0].date}T00:00:00`);
                          let dayOfWeek = firstDayDate.getDay(); // 0 is Sun
                          // convert 0 (Sun) to 6, 1 (Mon) to 0
                          const offset = (dayOfWeek + 6) % 7;
                          return Array.from({ length: offset }, (_, idx) => (
                            <div key={`blank-${idx}`} className="h-14 rounded-xl border border-transparent bg-slate-50/30 dark:bg-stone-800/10" />
                          ));
                        })()}

                        {/* Calendar Days */}
                        {(teacherViewData?.calendar || []).map(day => {
                          const isSelected = selectedCalendarDate === day.date;
                          let bgClass = 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-stone-800/40 dark:border-stone-700 dark:text-stone-400';

                          if (day.color === 'green') {
                            bgClass = 'bg-emerald-50 border-emerald-300 text-emerald-800 dark:bg-emerald-950/50 dark:border-emerald-800 dark:text-emerald-300';
                          } else if (day.color === 'amber') {
                            bgClass = 'bg-amber-50 border-amber-300 text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-300';
                          } else if (day.color === 'red') {
                            bgClass = 'bg-rose-50 border-rose-300 text-rose-800 dark:bg-rose-950/50 dark:border-rose-800 dark:text-rose-300';
                          } else if (day.color === 'muted') {
                            bgClass = 'bg-slate-50/50 border-slate-200 text-slate-400 dark:bg-stone-800/20 dark:border-stone-800 dark:text-stone-600';
                          }

                          return (
                            <button
                              key={day.date}
                              onClick={() => setSelectedCalendarDate(isSelected ? '' : day.date)}
                              className={`flex h-14 flex-col justify-between rounded-xl border p-1.5 text-left transition hover:scale-105 ${bgClass} ${
                                isSelected ? 'ring-2 ring-orange-500 shadow-md' : ''
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-black">{day.day}</span>
                                {day.scheduled > 0 && (
                                  <span className="text-[10px] font-bold">
                                    {day.taken}/{day.scheduled}
                                  </span>
                                )}
                              </div>
                              <span className="text-[9px] font-semibold truncate">
                                {day.status}
                              </span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Legend below calendar */}
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[11px] font-bold">
                        <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" /> All Taken
                        </span>
                        <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400">
                          <span className="h-2 w-2 rounded-full bg-amber-500" /> Late / Partial
                        </span>
                        <span className="flex items-center gap-1 text-rose-700 dark:text-rose-400">
                          <span className="h-2 w-2 rounded-full bg-rose-500" /> Missed
                        </span>
                        <span className="flex items-center gap-1 text-slate-500">
                          <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-stone-600" /> No Class
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Batch and Subject Summary (5 Cols) */}
                <div className="lg:col-span-5 rounded-2xl border border-orange-200 bg-white p-5 shadow-sm dark:border-stone-800 dark:bg-stone-900">
                  <div className="border-b border-orange-100 pb-3 dark:border-stone-800">
                    <h4 className="font-extrabold text-slate-800 dark:text-white">Batch & Subject Summary</h4>
                    <p className="text-xs text-slate-400">Monthly breakdown for assigned batches</p>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    {!teacherViewData?.batchSubjectSummary?.length ? (
                      <p className="p-8 text-center text-xs text-slate-400">No batch classes recorded this month.</p>
                    ) : (
                      <table className="w-full text-left text-xs">
                        <thead className="bg-[#FFF7ED] text-[10px] font-black uppercase text-orange-700 dark:bg-stone-800 dark:text-orange-400">
                          <tr>
                            <th className="px-3 py-2.5">Batch</th>
                            <th className="px-3 py-2.5">Subject</th>
                            <th className="px-2 py-2.5 text-center">Taken</th>
                            <th className="px-2 py-2.5 text-center">Missed</th>
                            <th className="px-3 py-2.5 text-right">Hours</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                          {teacherViewData.batchSubjectSummary.map((item, idx) => (
                            <tr key={idx} className="hover:bg-orange-50/20 dark:hover:bg-stone-800/30">
                              <td className="px-3 py-3 font-bold text-slate-800 dark:text-white">{item.batchName}</td>
                              <td className="px-3 py-3 font-semibold text-slate-600 dark:text-stone-300">{item.subjectName}</td>
                              <td className="px-2 py-3 text-center font-bold text-emerald-600 dark:text-emerald-400">{item.taken}</td>
                              <td className="px-2 py-3 text-center font-bold text-rose-600 dark:text-rose-400">{item.missed}</td>
                              <td className="px-3 py-3 text-right font-black text-slate-900 dark:text-white">{item.hours}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Card: Class Log */}
              <div className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-[#FFF7ED] px-6 py-4 dark:border-stone-800 dark:bg-stone-800/60">
                  <div>
                    <h4 className="font-extrabold text-slate-800 dark:text-white">Class Log</h4>
                    <p className="text-xs text-slate-500 dark:text-stone-400">
                      {selectedCalendarDate ? (
                        <>
                          Showing classes for <span className="font-bold text-orange-600 dark:text-orange-400">{selectedCalendarDate}</span>
                        </>
                      ) : (
                        `All scheduled classes for ${months[Number(selectedMonth.split('-')[1]) - 1]} ${selectedMonth.split('-')[0]}`
                      )}
                    </p>
                  </div>
                  {selectedCalendarDate && (
                    <button
                      onClick={() => setSelectedCalendarDate('')}
                      className="rounded-lg border border-orange-300 bg-white px-3 py-1 text-xs font-bold text-orange-600 shadow-sm hover:bg-orange-50 dark:border-stone-700 dark:bg-stone-800 dark:text-orange-400"
                    >
                      Show All
                    </button>
                  )}
                </div>

                {!filteredClassLog.length ? (
                  <div className="p-12 text-center text-slate-400">No scheduled classes found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FFF7ED]/50 text-[10px] font-black uppercase tracking-wider text-orange-700 dark:bg-stone-800/40 dark:text-orange-400">
                        <tr>
                          <th className="px-5 py-3">Date</th>
                          <th className="px-4 py-3">Batch</th>
                          <th className="px-4 py-3">Subject</th>
                          <th className="px-4 py-3">Scheduled Time</th>
                          <th className="px-4 py-3">Joined Time</th>
                          <th className="px-4 py-3">Duration</th>
                          <th className="px-4 py-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-stone-800">
                        {filteredClassLog.map(item => (
                          <tr key={item.id} className="hover:bg-orange-50/20 dark:hover:bg-stone-800/30">
                            <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-stone-200">{item.date}</td>
                            <td className="px-4 py-3.5 font-semibold text-slate-700 dark:text-stone-300">{item.batch}</td>
                            <td className="px-4 py-3.5 font-semibold text-slate-700 dark:text-stone-300">{item.subject}</td>
                            <td className="px-4 py-3.5 text-slate-600 dark:text-stone-400">{item.scheduledTime}</td>
                            <td className="px-4 py-3.5 font-medium text-slate-800 dark:text-stone-200">{item.joinedTime}</td>
                            <td className="px-4 py-3.5 text-slate-600 dark:text-stone-400">{item.duration}</td>
                            <td className="px-4 py-3.5 text-right">
                              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusBadge(item.status)}`}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ==================== ADMIN EDIT ATTENDANCE MODAL ==================== */}
      {editingTeacher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-orange-200 bg-white p-6 shadow-2xl dark:border-stone-800 dark:bg-stone-900 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between border-b border-orange-100 pb-4 dark:border-stone-800">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  Edit Attendance: {editingTeacher.name}
                </h3>
                <p className="mt-0.5 text-xs text-orange-600 dark:text-orange-400 font-semibold">
                  {dayRegisterData?.formattedDate || dayRegisterDate}
                </p>
              </div>
              <button
                onClick={() => setEditingTeacher(null)}
                className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-stone-800 dark:hover:text-stone-300"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {/* Status Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                  Attendance Status
                </label>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {[
                    { value: 'present', label: 'Present', color: 'bg-emerald-500' },
                    { value: 'late', label: 'Late', color: 'bg-amber-500' },
                    { value: 'absent', label: 'Absent', color: 'bg-rose-500' },
                    { value: 'holiday', label: 'Holiday', color: 'bg-purple-500' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setEditStatus(opt.value)}
                      className={`rounded-xl border py-2.5 text-xs font-bold transition ${
                        editStatus === opt.value
                          ? `${opt.color} text-white shadow-md border-transparent`
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                    Check In Time
                  </label>
                  <input
                    aria-label="Edit Check In Time"
                    type="time"
                    value={editCheckIn}
                    onChange={e => setEditCheckIn(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                    Check Out Time
                  </label>
                  <input
                    aria-label="Edit Check Out Time"
                    type="time"
                    value={editCheckOut}
                    onChange={e => setEditCheckOut(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                  />
                </div>
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-stone-400">
                  Reason for Override (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. System glitch, approved shift, manual attendance"
                  value={editReason}
                  onChange={e => setEditReason(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                />
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300">
                <b>Notice:</b> This overrides the teacher’s daily attendance in payroll. Auto-marked class join logs will be preserved.
              </div>
            </div>

            {/* Modal Actions */}
            <div className="mt-6 flex items-center justify-end gap-3 border-t border-orange-100 pt-4 dark:border-stone-800">
              <button
                type="button"
                onClick={() => setEditingTeacher(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveEdit}
                className="rounded-xl bg-orange-500 px-5 py-2 text-sm font-bold text-white shadow-md hover:bg-orange-600 disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save Attendance'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
