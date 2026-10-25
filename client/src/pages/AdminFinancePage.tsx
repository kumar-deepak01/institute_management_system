import { memo, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import AdminIcon from '../components/AdminIcon';
import MultiSelect, { type MultiSelectOption } from '../components/MultiSelect';
import {
  financeDownload,
  financeGet,
  financePost,
  financePut,
  invalidateFinanceCache,
  type FinanceItem,
  type FinanceLookups,
} from '../services/finance';

type FinanceData = Record<string, unknown>;
type Notice = { kind: 'success' | 'error'; text: string } | null;
const value = (item: FinanceItem | FinanceData | undefined, key: string, fallback = '') =>
  String(item?.[key] ?? fallback);
const numeric = (item: FinanceItem | FinanceData | undefined, key: string) =>
  Number(item?.[key] || 0);
const rupees = (amount: unknown) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(
    Number(amount) || 0,
  );
const displayDate = (date: unknown) =>
  date
    ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
        new Date(String(date)),
      )
    : '—';
const today = () => new Date().toISOString().slice(0, 10);
const titleFor = (path: string) =>
  ({
    '/admin/fees': 'Smart Billing Hub',
    '/admin/fee-structures': 'Smart Billing Hub',
    '/admin/fees/report': 'Fee Collection Report',
    '/admin/discounts': 'Fee Discounts',
    '/admin/late-fees': 'Late Fee Automation',
    '/admin/payment-reminders': 'Payment Reminder Automation',
    '/admin/deletion-audit': 'Fee Deletion Audit Log',
    '/admin/accounting-export': 'Accounting / Tally Export',
    '/admin/expenses': 'Expenses',
    '/admin/expense-heads': 'Expense Heads',
    '/admin/expenses/new': 'Record Expense',
    '/admin/income': 'Income',
    '/admin/income-heads': 'Income Heads',
    '/admin/income/new': 'Record Income',
  } as Record<string, string>)[path] || 'Smart Billing Hub';

const DEFAULT_SESSION_YEARS = ['2024-25', '2025-26', '2026-27', '2027-28', '2028-29'];

function Panel({
  title,
  icon,
  right,
  children,
  className = '',
}: {
  title: string;
  icon?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm ${className}`}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-100/70 to-orange-50/50 px-5 py-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          {icon && <AdminIcon name={icon} className="h-5 w-5 text-orange-500" />}
          {title}
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function Button({
  children,
  onClick,
  tone = 'blue',
  type = 'button',
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'blue' | 'white' | 'green' | 'red' | 'amber';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const tones = {
    blue: 'bg-orange-500 text-white hover:bg-orange-600 shadow-orange-900/10',
    white: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    green: 'bg-emerald-600 text-white hover:bg-emerald-700',
    red: 'bg-rose-600 text-white hover:bg-rose-700',
    amber: 'bg-amber-500 text-white hover:bg-amber-600',
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
      <div>
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-50 text-slate-400">
          <AdminIcon name="inbox" className="h-7 w-7" />
        </span>
        <p className="mt-4 font-bold text-slate-800">{title}</p>
        {detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}
      </div>
    </div>
  );
}

function Stat({
  label,
  amount,
  color = 'blue',
  sub,
}: {
  label: string;
  amount: ReactNode;
  color?: string;
  sub?: string;
}) {
  const colorClass: Record<string, string> = {
    blue: 'text-orange-600',
    green: 'text-emerald-600',
    red: 'text-rose-600',
    amber: 'text-amber-600',
    cyan: 'text-cyan-600',
    violet: 'text-violet-600',
  };
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-extrabold ${colorClass[color] || colorClass.blue}`}>{amount}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </article>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100';

function Dialog({
  title,
  onClose,
  children,
  width = 'max-w-2xl',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/55 p-4"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full ${width} overflow-y-auto rounded-2xl bg-white shadow-2xl`}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-4 text-white">
          <h2 className="text-lg font-bold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-1.5 hover:bg-white/10">
            <AdminIcon name="close" className="h-5 w-5" />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}

const FeeRow = memo(function FeeRow({
  item,
  onCollect,
  onLedger,
  onEditFee,
  onAssignFee,
}: {
  item: FinanceItem;
  onCollect: (item: FinanceItem) => void;
  onLedger: (item: FinanceItem) => void;
  onEditFee: (item: FinanceItem) => void;
  onAssignFee: (item: FinanceItem) => void;
}) {
  const isAssigned = Boolean(item.id);
  const status = value(item, 'computed_status', isAssigned ? 'Upcoming' : 'Unassigned');
  const badge =
    status === 'Paid'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'Overdue'
      ? 'bg-rose-100 text-rose-700'
      : status === 'Partial'
      ? 'bg-amber-100 text-amber-800'
      : status === 'Unassigned'
      ? 'bg-slate-100 text-slate-700'
      : 'bg-cyan-100 text-cyan-800';

  return (
    <tr className="border-t border-slate-100 even:bg-slate-50/70">
      <td className="px-4 py-3">
        <b>{value(item, 'student_name', 'Student')}</b>
        <span className="mt-0.5 block text-xs text-slate-500">Adm: {value(item, 'admission_number', '—')}</span>
      </td>
      <td className="px-4 py-3 text-sm font-semibold">{value(item, 'batch_name', '—')}</td>
      <td className="px-4 py-3">
        <b>{value(item, 'title', isAssigned ? '' : 'No fee assigned')}</b>
        {isAssigned && <span className="mt-1 block text-xs text-orange-600">{value(item, 'fee_type', 'Tuition')}</span>}
      </td>
      <td className="px-4 py-3 font-semibold">{isAssigned ? rupees(item.totalAmount) : '—'}</td>
      <td className="px-4 py-3 font-semibold text-emerald-700">{isAssigned ? rupees(item.paid) : '—'}</td>
      <td className="px-4 py-3 font-bold text-rose-600">{isAssigned ? rupees(item.balance) : '—'}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${badge}`}>{status}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">{isAssigned ? displayDate(item.due_date) : '—'}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {isAssigned && Number(item.balance) > 0 && <Button onClick={() => onCollect(item)}>Collect</Button>}
          {isAssigned ? (
            <Button tone="white" onClick={() => onEditFee(item)}>
              <AdminIcon name="edit" className="h-4 w-4 text-orange-500" />
              Edit Fee
            </Button>
          ) : (
            <Button tone="amber" onClick={() => onAssignFee(item)}>
              <AdminIcon name="plus" className="h-4 w-4" />
              Assign Fee
            </Button>
          )}
          {isAssigned && (
            <Button tone="white" onClick={() => onLedger(item)}>
              <AdminIcon name="report" className="h-4 w-4" />
              Ledger
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
});

export default function AdminFinancePage() {
  const location = useLocation(),
    navigate = useNavigate(),
    [searchParams] = useSearchParams();
  const path = location.pathname;
  const tab =
    path === '/admin/fee-structures'
      ? 'templates'
      : searchParams.get('tab') || (path === '/admin/fees' ? 'templates' : 'dues');

  const [data, setData] = useState<FinanceData>({});
  const [lookups, setLookups] = useState<FinanceLookups>({
    students: [],
    batches: [],
    courses: [],
    subjects: [],
    academicYears: [],
    staff: [],
    feeTypes: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState<Notice>(null),
    [refresh, setRefresh] = useState(0);
  const [modal, setModal] = useState(''),
    [selected, setSelected] = useState<FinanceItem | null>(null),
    [saving, setSaving] = useState(false),
    [csvFile, setCsvFile] = useState<File | null>(null);

  // Form states for modals
  const [form, setForm] = useState<Record<string, string>>({
    date: today(),
    paidAt: today(),
    method: 'cash',
    type: 'fixed',
    scope: 'global',
    frequency: 'one-time',
    trigger: 'before_due',
    days: '3',
    sendTime: '09:00',
    channels: 'in_app',
    installments: '4',
    intervalDays: '30',
    academicYear: '2025-26',
  });

  // Dedicated multi-select states for fee assignment modals
  const [selectedStructureId, setSelectedStructureId] = useState('');
  const [selectedFilterBatches, setSelectedFilterBatches] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedSessionYear, setSelectedSessionYear] = useState('2025-26');
  const [overrideDueDate, setOverrideDueDate] = useState('');
  const [editFeeTitle, setEditFeeTitle] = useState('');
  const [editFeeAmount, setEditFeeAmount] = useState('');
  const [modalError, setModalError] = useState('');

  const [search, setSearch] = useState(''),
    [debounced, setDebounced] = useState(''),
    [statusFilter, setStatusFilter] = useState('all'),
    [batchFilter, setBatchFilter] = useState(''),
    [courseFilter, setCourseFilter] = useState(''),
    [studentType, setStudentType] = useState('active'),
    [typeFilter, setTypeFilter] = useState('all'),
    [startDate, setStartDate] = useState(''),
    [endDate, setEndDate] = useState(''),
    [scopeFilter, setScopeFilter] = useState('all'),
    [overdue, setOverdue] = useState(false),
    [page, setPage] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const pageTitle = titleFor(path);
  const showNotice = useCallback((kind: 'success' | 'error', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const sessionYears = useMemo(() => {
    const valid = (lookups.academicYears || [])
      .map(y => String(y.name || y.id || ''))
      .filter(
        name =>
          name &&
          !name.toLowerCase().includes('deepak') &&
          !name.toLowerCase().includes('admin'),
      );
    return Array.from(new Set([...valid, ...DEFAULT_SESSION_YEARS]));
  }, [lookups.academicYears]);

  const displayAcademicYear = useCallback(
    (academicYearId: string) => {
      const found = (lookups.academicYears || []).find(y => value(y, 'id') === academicYearId);
      const name = value(found, 'name', academicYearId);
      if (!name || name.toLowerCase().includes('deepak') || name.toLowerCase().includes('admin')) {
        return '2025-26';
      }
      return name;
    },
    [lookups.academicYears],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ limit: '25', offset: String(page * 25) });
    if (debounced) query.set('search', debounced);
    if (statusFilter !== 'all') query.set('status', statusFilter);
    if (batchFilter) query.set('batchId', batchFilter);
    if (overdue) query.set('overdue', '1');
    if (courseFilter) query.set('courseId', courseFilter);
    if (studentType !== 'all') query.set('studentType', studentType);
    if (typeFilter !== 'all') query.set('type', typeFilter);
    if (startDate) query.set('startDate', startDate);
    if (endDate) query.set('endDate', endDate);

    const jobs: Array<Promise<unknown>> = [];
    const kind =
      path === '/admin/fees'
        ? tab === 'templates'
          ? 'structures'
          : 'fees'
        : path === '/admin/fee-structures'
        ? 'structures'
        : path === '/admin/fees/report'
        ? 'report'
        : path === '/admin/discounts'
        ? 'discounts'
        : path === '/admin/late-fees'
        ? 'late'
        : path === '/admin/payment-reminders'
        ? 'reminders'
        : path === '/admin/deletion-audit'
        ? 'audit'
        : path === '/admin/accounting-export'
        ? 'report'
        : path === '/admin/expenses'
        ? 'expenses'
        : path === '/admin/expense-heads'
        ? 'expenseHeads'
        : path === '/admin/income'
        ? 'income'
        : path === '/admin/income-heads'
        ? 'incomeHeads'
        : path === '/admin/expenses/new'
        ? 'expenseHeads'
        : path === '/admin/income/new'
        ? 'incomeHeads'
        : 'fees';

    if (kind === 'fees') {
      jobs.push(
        financeGet('/fees/stats'),
        financeGet(`/fees?${query.toString()}`),
        financeGet<FinanceLookups>('/lookups'),
      );
    }
    if (kind === 'structures') {
      jobs.push(financeGet(`/structures?scope=${scopeFilter}`), financeGet<FinanceLookups>('/lookups'));
    }
    if (kind === 'report') jobs.push(financeGet(`/report?from=${today().slice(0, 4)}-01-01&to=${today()}`));
    if (kind === 'discounts') jobs.push(financeGet('/discounts'));
    if (kind === 'late') jobs.push(financeGet('/late-fees'));
    if (kind === 'reminders') jobs.push(financeGet('/reminders'));
    if (kind === 'audit') jobs.push(financeGet(`/payments/audit?search=${encodeURIComponent(debounced)}`));
    if (kind === 'expenses') jobs.push(financeGet(`/expenses?search=${encodeURIComponent(debounced)}`));
    if (kind === 'expenseHeads') jobs.push(financeGet('/expense-heads'));
    if (kind === 'income') jobs.push(financeGet(`/income?search=${encodeURIComponent(debounced)}`));
    if (kind === 'incomeHeads') jobs.push(financeGet('/income-heads'));
    if (['expenses', 'expenseHeads', 'income', 'incomeHeads'].includes(kind) && path.endsWith('/new')) {
      jobs.push(financeGet<FinanceLookups>('/lookups'));
    }
    if (kind === 'fees' && tab === 'installments') jobs.push(financeGet('/emi'));

    const results = await Promise.allSettled(jobs);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined;
    const valueAt = (index: number) =>
      results[index]?.status === 'fulfilled'
        ? (results[index] as PromiseFulfilledResult<unknown>).value
        : undefined;

    if (valueAt(0) && typeof valueAt(0) === 'object') setData(prev => ({ ...prev, ...(valueAt(0) as FinanceData) }));
    if (kind === 'fees') {
      setData(prev => ({
        ...prev,
        ...((valueAt(1) as FinanceData) || {}),
        stats: ((valueAt(0) as FinanceData | undefined)?.stats as FinanceData) || prev.stats,
        emi: valueAt(3) || prev.emi,
      }));
    }
    if (kind === 'fees' && valueAt(2)) setLookups(valueAt(2) as FinanceLookups);
    if (kind === 'structures' && valueAt(1)) setLookups(valueAt(1) as FinanceLookups);
    if (path.endsWith('/new') && valueAt(1)) setLookups(valueAt(1) as FinanceLookups);
    if (rejected) setError(rejected.reason instanceof Error ? rejected.reason.message : 'Finance data is temporarily unavailable.');
    setLoading(false);
  }, [
    path,
    debounced,
    statusFilter,
    batchFilter,
    courseFilter,
    studentType,
    typeFilter,
    startDate,
    endDate,
    scopeFilter,
    overdue,
    page,
    tab,
    refresh,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateForm = (key: string, val: string) => setForm(current => ({ ...current, [key]: val }));

  const openModal = (name: string, item?: FinanceItem) => {
    setSelected(item || null);
    setModalError('');
    setSelectedStructureId('');
    setSelectedFilterBatches([]);
    setSelectedStudents([]);
    setSelectedBatches([]);
    setSelectedSubjects([]);
    setSelectedSessionYear('2025-26');
    setOverrideDueDate('');

    if (name === 'editFee' && item) {
      setSelectedStructureId(value(item, 'structure_id'));
      setEditFeeTitle(value(item, 'title'));
      setEditFeeAmount(String(item.total_amount || item.totalAmount || ''));
      setOverrideDueDate(value(item, 'due_date', '').slice(0, 10));
      const sIds = (item.subject_ids as string[] | undefined) || (item.subject_id ? [String(item.subject_id)] : []);
      setSelectedSubjects(sIds);
    }
    if (name === 'assignStudentSingle' && item) {
      setSelectedStudents([value(item, 'student_key', value(item, 'id'))]);
    }
    if (item && name === 'assignStudents') {
      setSelectedStructureId(value(item, 'id'));
    }

    setForm({
      date: today(),
      paidAt: today(),
      method: 'cash',
      type: 'fixed',
      scope: 'global',
      frequency: 'one-time',
      trigger: 'before_due',
      days: '3',
      sendTime: '09:00',
      channels: 'in_app',
      installments: '4',
      intervalDays: '30',
      academicYear: '2025-26',
      ...(item ? { amount: String(item.balance || item.total_amount || ''), studentFeeId: value(item, 'id') } : {}),
    });
    setModal(name);
  };

  const closeModal = () => {
    setModal('');
    setSelected(null);
    setModalError('');
  };

  const handleStructureSelectChange = (structureId: string) => {
    setSelectedStructureId(structureId);
    const structures = (data.items as FinanceItem[] | undefined) || [];
    const struct = structures.find(s => value(s, 'id') === structureId);
    if (struct) {
      if (modal === 'editFee') {
        setEditFeeTitle(value(struct, 'title'));
        setEditFeeAmount(String(struct.total_amount || ''));
      }
    }
  };

  // Dedicated handlers for fee assignment submissions
  const handleAssignStudentsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStructureId) {
      setModalError('Please select a fee template structure.');
      return;
    }
    if (!selectedStudents.length) {
      setModalError('Please select at least one student.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const res = await financePost<{ created?: number; duplicates?: number; warning?: string }>('/fees/assign', {
        structureId: selectedStructureId,
        scope: 'student',
        studentKeys: selectedStudents,
        dueDate: overrideDueDate || null,
        academicYearId: selectedSessionYear,
      });
      if (res.warning) {
        showNotice('success', res.warning);
      } else {
        showNotice('success', `Fee assigned to ${res.created ?? selectedStudents.length} student(s) successfully.`);
      }
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign fee.';
      setModalError(msg);
      showNotice('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignBatchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStructureId) {
      setModalError('Please select a fee template structure.');
      return;
    }
    if (!selectedBatches.length) {
      setModalError('Please select at least one batch.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const res = await financePost<{ created?: number; duplicates?: number; warning?: string }>('/fees/assign', {
        structureId: selectedStructureId,
        scope: 'batch',
        batchIds: selectedBatches,
        dueDate: overrideDueDate || null,
        academicYearId: selectedSessionYear,
      });
      if (res.warning) {
        showNotice('success', res.warning);
      } else {
        showNotice('success', `Fee assigned to ${res.created ?? 0} students across selected batches.`);
      }
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign fee to batch.';
      setModalError(msg);
      showNotice('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignSubjectSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStructureId) {
      setModalError('Please select a fee template structure.');
      return;
    }
    if (!selectedSubjects.length) {
      setModalError('Please select at least one subject.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const res = await financePost<{ created?: number; duplicates?: number; warning?: string }>('/fees/assign', {
        structureId: selectedStructureId,
        scope: 'subject',
        subjectIds: selectedSubjects,
        batchIds: selectedBatches,
        studentKeys: selectedStudents,
        dueDate: overrideDueDate || null,
        academicYearId: selectedSessionYear,
      });
      if (res.warning) {
        showNotice('success', res.warning);
      } else {
        showNotice('success', `Fee assigned by subject to ${res.created ?? 0} student(s) successfully.`);
      }
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign fee by subject.';
      setModalError(msg);
      showNotice('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleEditFeeSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !selected.id) return;
    if (!editFeeAmount || Number(editFeeAmount) <= 0) {
      setModalError('Please enter a valid fee amount.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      await financePut(`/fees/${encodeURIComponent(value(selected, 'id'))}`, {
        structureId: selectedStructureId || null,
        title: editFeeTitle || value(selected, 'title'),
        amount: editFeeAmount,
        dueDate: overrideDueDate || null,
        subjectIds: selectedSubjects,
      });
      showNotice('success', 'Student fee updated and dues recalculated.');
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update fee.';
      setModalError(msg);
      showNotice('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignStudentSingleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedStructureId) {
      setModalError('Please select a fee template structure.');
      return;
    }
    const studentKey = value(selected || undefined, 'student_key', value(selected || undefined, 'id'));
    if (!studentKey) {
      setModalError('Student could not be identified.');
      return;
    }
    setSaving(true);
    setModalError('');
    try {
      const res = await financePost<{ created?: number; duplicates?: number; warning?: string }>('/fees/assign', {
        structureId: selectedStructureId,
        scope: 'student',
        studentKeys: [studentKey],
        dueDate: overrideDueDate || null,
        academicYearId: selectedSessionYear,
        subjectIds: selectedSubjects,
      });
      if (res.warning) {
        showNotice('success', res.warning);
      } else {
        showNotice('success', 'Fee structure assigned to student.');
      }
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to assign fee.';
      setModalError(msg);
      showNotice('error', msg);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (modal === 'import') {
        if (!csvFile) throw new Error('Choose a CSV file to import.');
        if (csvFile.size > 2 * 1024 * 1024) throw new Error('CSV file must be no larger than 2 MB.');
        const result = await financePost<FinanceData>('/import', { csv: await csvFile.text() });
        showNotice('success', `${numeric(result, 'imported')} fee receipt(s) imported.`);
        setCsvFile(null);
      } else if (modal === 'collect' && selected) {
        await financePost(`/fees/${encodeURIComponent(value(selected, 'id'))}/payments`, {
          amount: form.amount,
          method: form.method,
          reference: form.reference || '',
          idempotencyKey: crypto.randomUUID(),
          paidAt: form.paidAt ? new Date(`${form.paidAt}T12:00:00`).toISOString() : undefined,
        });
        showNotice('success', 'Payment recorded and receipt number created.');
      } else if (modal === 'reverse' && selected) {
        await financePost(`/payments/${encodeURIComponent(value(selected, 'id'))}/reverse`, {
          reason: form.reason,
        });
        showNotice('success', 'Payment reversal recorded in the audit log.');
      } else if (modal === 'structure') {
        await financePost('/structures', {
          title: form.title,
          feeTypeId: form.feeTypeId,
          componentGroup: form.componentGroup || 'Other',
          amount: form.amount,
          frequency: form.frequency,
          academicYearId: form.academicYearId || selectedSessionYear,
          scope: form.scope,
          dueDate: form.dueDate || null,
          notes: form.notes || '',
          mandatoryEnrollment: form.mandatoryEnrollment === 'true',
        });
        showNotice('success', 'Fee structure created.');
      } else if (modal === 'discount') {
        await financePost('/discounts', {
          name: form.name,
          code: form.code,
          type: form.type,
          value: form.value,
          appliesTo: form.appliesTo || 'all',
          validFrom: form.validFrom || null,
          validTo: form.validTo || null,
          usageLimit: form.usageLimit || null,
        });
        showNotice('success', 'Discount created.');
      } else if (modal === 'applyDiscount' && selected) {
        await financePost(`/fees/${encodeURIComponent(value(selected, 'id'))}/discount`, {
          discountId: form.discountId,
        });
        showNotice('success', 'Discount applied to fee.');
      } else if (modal === 'late') {
        await financePost('/late-fees', {
          name: form.name,
          type: form.type,
          amount: form.amount,
          graceDays: form.graceDays || '0',
          maxCap: form.maxCap || null,
        });
        showNotice('success', 'Late fee rule created.');
      } else if (modal === 'reminder') {
        await financePost('/reminders', {
          name: form.name,
          trigger: form.trigger,
          days: form.days,
          sendTime: form.sendTime,
          channels: form.channels.split(',').map(x => x.trim()).filter(Boolean),
          emailSubject: form.emailSubject || '',
          emailBody: form.emailBody || '',
          smsTemplate: form.smsTemplate || '',
          whatsappTemplate: form.whatsappTemplate || '',
        });
        showNotice('success', 'Reminder rule created.');
      } else if (modal === 'emiPlan') {
        await financePost('/emi/plans', {
          name: form.name,
          installments: form.installments,
          intervalDays: form.intervalDays,
        });
        showNotice('success', 'EMI plan created.');
      } else if (modal === 'assignEmi') {
        await financePost('/emi/assign', {
          studentFeeId: form.studentFeeId,
          planId: form.planId,
          firstDueDate: form.firstDueDate,
        });
        showNotice('success', 'Fee split into EMI installments.');
      } else if (modal === 'head') {
        const group = form.headGroup === 'income' ? 'income-heads' : 'expense-heads';
        await financePost(`/${group}`, { name: form.name, description: form.description || '' });
        showNotice('success', `${form.headGroup === 'income' ? 'Income' : 'Expense'} head created.`);
      } else if (modal === 'expense') {
        await financePost('/expenses', {
          title: form.title,
          headId: form.headId,
          amount: form.amount,
          date: form.date,
          method: form.method,
          reference: form.reference || '',
          notes: form.notes || '',
        });
        showNotice('success', 'Expense recorded.');
      } else if (modal === 'income') {
        await financePost('/income', {
          title: form.title,
          headId: form.headId,
          amount: form.amount,
          date: form.date,
          method: form.method,
          reference: form.reference || '',
          notes: form.notes || '',
        });
        showNotice('success', 'Income recorded.');
      }
      closeModal();
      setRefresh(x => x + 1);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Finance action failed.');
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async (pathname: string) => {
    try {
      const result = await financePost<FinanceData>(pathname, {});
      showNotice('success', `${String(result.queued ?? result.applied ?? 0)} record(s) processed.`);
      setRefresh(x => x + 1);
    } catch (err) {
      showNotice('error', err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const items = (data.items as FinanceItem[] | undefined) || [];
  const stats = (data.stats as FinanceData | undefined) || {};

  // Batch options for MultiSelect
  const batchOptions: MultiSelectOption[] = useMemo(
    () =>
      (lookups.batches || []).map(b => ({
        id: value(b, 'id'),
        label: value(b, 'name'),
        sub: value(b, 'course_name', 'Batch'),
      })),
    [lookups.batches],
  );

  // Subject options for MultiSelect
  const subjectOptions: MultiSelectOption[] = useMemo(
    () =>
      (lookups.subjects || []).map(s => ({
        id: value(s, 'id'),
        label: value(s, 'name'),
        badge: value(s, 'status', 'Active'),
      })),
    [lookups.subjects],
  );

  // Filtered student options for MultiSelect
  const studentOptions: MultiSelectOption[] = useMemo(() => {
    let list = lookups.students || [];
    if (selectedFilterBatches.length > 0) {
      list = list.filter(st => selectedFilterBatches.includes(value(st, 'batch_id')));
    }
    return list.map(st => {
      const batchName = value(lookups.batches.find(b => value(b, 'id') === value(st, 'batch_id')), 'name', '—');
      return {
        id: value(st, 'id'),
        label: value(st, 'name'),
        sub: `Adm: ${value(st, 'roll', value(st, 'student_id', '—'))}${st.phone ? ` · Ph: ${value(st, 'phone')}` : ''} · Batch: ${batchName}`,
      };
    });
  }, [lookups.students, lookups.batches, selectedFilterBatches]);

  const tabsNav = (
    <nav className="flex w-fit max-w-full gap-2 overflow-x-auto rounded-full bg-white/75 p-2 shadow-sm">
      {[
        ['dues', 'Dues & Collections'],
        ['installments', 'EMI Installments'],
        ['templates', 'Fee Templates'],
      ].map(([key, label]) => (
        <button
          key={key}
          onClick={() => {
            if (key === 'templates') {
              navigate('/admin/fee-structures');
            } else {
              navigate(`/admin/fees?tab=${key}`);
            }
          }}
          className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold ${
            tab === key
              ? 'bg-orange-500 text-white shadow'
              : 'text-slate-600 hover:bg-orange-50 hover:text-orange-600'
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  const feePage = () => {
    if (tab === 'templates')
      return (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="white" onClick={() => openModal('typeManager')}>
              <AdminIcon name="tag" className="h-4 w-4 text-orange-500" />
              Fee Types
            </Button>
            <Button tone="white" onClick={() => openModal('assignSubject')}>
              <AdminIcon name="book" className="h-4 w-4 text-orange-500" />
              Assign by Subject
            </Button>
            <Button tone="white" onClick={() => openModal('assignBatch')}>
              <AdminIcon name="people" className="h-4 w-4 text-orange-500" />
              Assign to Batch
            </Button>
            <Button tone="white" onClick={() => openModal('assignStudents')}>
              <AdminIcon name="addPerson" className="h-4 w-4 text-orange-500" />
              Assign to Students
            </Button>
            <Button onClick={() => openModal('structure')}>
              <AdminIcon name="plus" className="h-4 w-4" />
              New Structure
            </Button>
          </div>
          {tabsNav}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Templates" amount={numeric(stats, 'templates')} />
            <Stat label="Batch Templates" amount={numeric(stats, 'batch_templates')} color="cyan" />
            <Stat label="Student-Specific" amount={numeric(stats, 'student_specific')} color="violet" />
            <Stat label="Active Value Sum" amount={rupees(stats.active_value_sum)} color="green" />
          </div>
          <Panel
            title="Reusable Fee Structures"
            icon="document"
            right={
              <div className="flex gap-1">
                {['all', 'global', 'batch', 'student'].map(scope => (
                  <button
                    key={scope}
                    onClick={() => setScopeFilter(scope)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-bold capitalize transition ${
                      scopeFilter === scope
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-slate-200 text-slate-600 hover:border-orange-400'
                    }`}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-orange-50/70 text-xs uppercase text-orange-800">
                  <tr>
                    {[
                      'Title Particular',
                      'Type',
                      'Total Amount',
                      'Frequency Intervals',
                      'Scope & Target',
                      'Academic Year',
                      'Status',
                      'Actions',
                    ].map(h => (
                      <th key={h} className="px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map(item => (
                      <tr key={value(item, 'id')} className="border-t border-slate-100 even:bg-slate-50/60">
                        <td className="px-4 py-3 font-bold">{value(item, 'title')}</td>
                        <td className="px-4 py-3">{value(item, 'fee_type_id', 'Tuition')}</td>
                        <td className="px-4 py-3">{rupees(item.total_amount)}</td>
                        <td className="px-4 py-3 capitalize">{value(item, 'frequency')}</td>
                        <td className="px-4 py-3 capitalize">{value(item, 'scope')}</td>
                        <td className="px-4 py-3">{displayAcademicYear(value(item, 'academic_year_id'))}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                              item.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {item.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button onClick={() => openModal('assignStudents', item)}>Assign</Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={8}>
                        <Empty title="No fee structures template created yet." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      );

    if (tab === 'installments') {
      const emi = (data.emi as FinanceData | undefined) || {};
      const plans = (emi.plans as FinanceItem[] | undefined) || [],
        installments = (emi.installments as FinanceItem[] | undefined) || [];
      return (
        <>
          {tabsNav}
          <div className="flex justify-end gap-2">
            <Button tone="white" onClick={() => openModal('assignEmi')}>
              Assign Plan to Fee
            </Button>
            <Button onClick={() => openModal('emiPlan')}>New EMI Plan</Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Total Pending EMI" amount={rupees((emi.stats as FinanceData | undefined)?.pending)} color="amber" />
            <Stat label="Active Installments" amount={numeric(emi.stats as FinanceData, 'total')} />
            <Stat label="Due This Week" amount={numeric(emi.stats as FinanceData, 'due_week')} color="violet" />
            <Stat label="Plans" amount={plans.length} color="cyan" />
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
            <Panel title="Due This Week" icon="calendar">
              {installments.filter(x => value(x, 'status') !== 'Paid').length ? (
                <div className="divide-y">
                  {installments
                    .filter(x => value(x, 'status') !== 'Paid')
                    .slice(0, 5)
                    .map(x => (
                      <div key={value(x, 'id')} className="flex justify-between p-4">
                        <span>
                          <b>{value(x, 'student_name')}</b>
                          <small className="block text-slate-500">
                            {value(x, 'title')} · {displayDate(x.due_date)}
                          </small>
                        </span>
                        <b>{rupees(x.balance)}</b>
                      </div>
                    ))}
                </div>
              ) : (
                <Empty title="All installments this week are collected!" />
              )}
            </Panel>
            <Panel title="Active EMI Options" icon="calendar">
              {plans.length ? (
                <div className="divide-y">
                  {plans.map(p => (
                    <div key={value(p, 'id')} className="p-4">
                      <b>{value(p, 'name')}</b>
                      <p className="text-sm text-slate-500">
                        {value(p, 'installments')} installments · every {value(p, 'interval_days')} days
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No custom EMI plans yet." detail="Click ‘New EMI Plan’ above to get started." />
              )}
            </Panel>
          </div>
          <Panel
            title="All Installments Ledger"
            icon="report"
            right={
              <div className="flex gap-1">
                {['All', 'Pending', 'Paid', 'Overdue'].map(x => (
                  <button key={x} className="rounded-lg bg-orange-50 px-3 py-1 text-xs font-bold text-orange-600">
                    {x}
                  </button>
                ))}
              </div>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-orange-50/70 text-xs uppercase text-orange-800">
                  <tr>
                    {['#', 'Student', 'Fee Particular', 'Tranche', 'Due Date', 'Amount', 'Collected', 'Balance', 'Status'].map(
                      x => (
                        <th key={x} className="px-3 py-3">
                          {x}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {installments.length ? (
                    installments.map(x => (
                      <tr key={value(x, 'id')} className="border-t">
                        <td className="px-3 py-3">{value(x, 'tranche_no')}</td>
                        <td className="px-3 py-3">
                          {value(x, 'student_name')}
                          <small className="block text-slate-500">Adm: {value(x, 'admission_number', '—')}</small>
                        </td>
                        <td className="px-3 py-3">{value(x, 'title')}</td>
                        <td className="px-3 py-3">{value(x, 'tranche_no')}</td>
                        <td className="px-3 py-3">{displayDate(x.due_date)}</td>
                        <td className="px-3 py-3">{rupees(x.amount)}</td>
                        <td className="px-3 py-3">{rupees(x.collected)}</td>
                        <td className="px-3 py-3">{rupees(x.balance)}</td>
                        <td className="px-3 py-3">{value(x, 'status')}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9}>
                        <Empty title="No EMI installments found." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      );
    }

    return (
      <>
        {tabsNav}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total Billed" amount={rupees(stats.totalBilled)} />
          <Stat
            label="Collected"
            amount={rupees(stats.collected)}
            color="green"
            sub={`${numeric(stats, 'collectionRate')}% rate`}
          />
          <Stat label="Pending" amount={rupees(stats.pending)} color="red" />
          <Stat label="Discounts Given" amount={rupees(stats.discountsGiven)} color="amber" />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex justify-between gap-4 text-sm">
            <p>
              <b>{rupees(stats.collected)}</b>
              <span className="ml-2 text-slate-400">collected of {rupees(stats.totalBilled)} billed</span>
            </p>
            <b className="text-orange-600">{numeric(stats, 'collectionRate')}%</b>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-orange-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 to-emerald-400"
              style={{ width: `${Math.min(100, numeric(stats, 'collectionRate'))}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>₹0</span>
            <span>{rupees(stats.totalBilled)}</span>
          </div>
        </section>
        <Panel title="Filter Fees" icon="filter">
          <div className="grid gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            <Field label="Search Student">
              <input
                className={inputClass}
                placeholder="Name or admission no..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </Field>
            <Field label="Course">
              <select className={inputClass} value={courseFilter} onChange={e => setCourseFilter(e.target.value)}>
                <option value="">All Courses</option>
                {lookups.courses.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Batch">
              <select className={inputClass} value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
                <option value="">All Batches</option>
                {lookups.batches.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Student Type">
              <select className={inputClass} value={studentType} onChange={e => setStudentType(e.target.value)}>
                <option value="active">Active</option>
                <option value="all">All Students</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <Field label="Status">
              <select className={inputClass} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                {['paid', 'partial', 'upcoming', 'overdue', 'unassigned'].map(x => (
                  <option key={x} value={x}>
                    {x[0].toUpperCase() + x.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select className={inputClass} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                {lookups.feeTypes.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start Date">
              <input
                type="date"
                className={inputClass}
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="End Date">
              <input type="date" className={inputClass} value={endDate} onChange={e => setEndDate(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Button
                onClick={() => {
                  setPage(0);
                  setRefresh(x => x + 1);
                }}
              >
                <AdminIcon name="filter" className="h-4 w-4" />
                Filter
              </Button>
              <Button
                tone="white"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                  setBatchFilter('');
                  setCourseFilter('');
                  setStudentType('active');
                  setTypeFilter('all');
                  setStartDate('');
                  setEndDate('');
                  setOverdue(false);
                }}
              >
                Clear
              </Button>
              <Button tone={overdue ? 'red' : 'white'} onClick={() => setOverdue(x => !x)}>
                Overdue Only
              </Button>
            </div>
          </div>
        </Panel>
        <Panel
          title="Fee Ledger"
          icon="payment"
          right={<span className="text-sm text-slate-500">{items.length} records</span>}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-orange-50/70 text-xs uppercase text-orange-800">
                <tr>
                  {['Student', 'Batch', 'Fee Particular', 'Total', 'Paid', 'Outstanding', 'Status', 'Due Date', 'Actions'].map(
                    x => (
                      <th key={x} className="px-4 py-3">
                        {x}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {items.length ? (
                  items.map(item => (
                    <FeeRow
                      key={value(item, 'id', value(item, 'student_key'))}
                      item={item}
                      onCollect={x => openModal('collect', x)}
                      onLedger={x => {
                        setSelected(x);
                        void financeGet<FinanceData>(`/fees/${encodeURIComponent(value(x, 'id'))}/ledger`, true)
                          .then(result => setData(prev => ({ ...prev, ledger: result.items || [] })))
                          .catch(e => showNotice('error', String(e)));
                        setModal('ledger');
                      }}
                      onEditFee={x => openModal('editFee', x)}
                      onAssignFee={x => openModal('assignStudentSingle', x)}
                    />
                  ))
                ) : (
                  <tr>
                    <td colSpan={9}>
                      <Empty
                        title="No fee records found."
                        detail="Fee records assigned to students will appear here."
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span>{numeric(data.page as FinanceData, 'total')} fee records</span>
            <div className="flex items-center gap-3">
              <Button tone="white" disabled={page === 0} onClick={() => setPage(x => Math.max(0, x - 1))}>
                Previous
              </Button>
              <span>Page {page + 1}</span>
              <Button tone="white" disabled={items.length < 25} onClick={() => setPage(x => x + 1)}>
                Next
              </Button>
            </div>
          </footer>
        </Panel>
      </>
    );
  };

  const toolbar = (title: string, description: string, action?: ReactNode) => (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-extrabold text-orange-600">{title}</h1>
        <p className="mt-1 text-slate-500">{description}</p>
      </div>
      {action}
    </header>
  );

  const table = (
    headers: string[],
    rows: FinanceItem[],
    empty: string,
    render: (item: FinanceItem) => ReactNode,
  ) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-orange-50/70 text-xs uppercase text-orange-800">
          <tr>
            {headers.map(x => (
              <th key={x} className="px-4 py-3">
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((item, i) => (
              <tr key={value(item, 'id', String(i))} className="border-t border-slate-100 even:bg-slate-50/60">
                {render(item)}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                <Empty title={empty} />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const buttonOpen = (name: string, label: string) => (
    <Button onClick={() => openModal(name)}>
      <AdminIcon name="plus" className="h-4 w-4" />
      {label}
    </Button>
  );

  let content: ReactNode;
  if (path === '/admin/fees' || path === '/admin/fee-structures') content = feePage();
  else if (path === '/admin/fees/report')
    content = (
      <>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total Collected" amount={rupees((data.stats as FinanceData | undefined)?.collected)} color="green" />
          <Stat
            label="Payments This Month"
            amount={numeric(data.stats as FinanceData, 'month_total') > 0 ? rupees((data.stats as FinanceData).month_total) : 0}
          />
          <Stat label="Transactions" amount={numeric(data.stats as FinanceData, 'payment_count')} color="cyan" />
          <Stat
            label="Cash + UPI"
            amount={rupees(numeric(data.stats as FinanceData, 'cash') + numeric(data.stats as FinanceData, 'upi'))}
            color="violet"
          />
        </div>
        <Panel title="Fee Collection Report" icon="chart">
          {table(
            ['Receipt', 'Date', 'Student / Admission No.', 'Fee Particular', 'Method', 'Amount'],
            items,
            'No fee collection records for this date range.',
            x => (
              <>
                {[
                  value(x, 'receipt_no'),
                  displayDate(x.paid_at),
                  <>
                    <b>{value(x, 'student_name')}</b>
                    <small className="block">Adm: {value(x, 'admission_number', '—')}</small>
                  </>,
                  value(x, 'fee_title'),
                  value(x, 'method'),
                  rupees(x.amount),
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  else if (path === '/admin/discounts')
    content = (
      <>
        {toolbar('Fee Discounts', 'Manage discount schemes for students.', buttonOpen('discount', 'New Discount'))}
        <Panel title="Discount Schemes" icon="tag">
          {table(
            ['Name', 'Code', 'Type & Value', 'Applies To', 'Validity', 'Usage', 'Status', 'Actions'],
            items,
            'No discounts yet. Create discount schemes to apply to students or batches.',
            x => (
              <>
                {[
                  value(x, 'name'),
                  value(x, 'code'),
                  `${value(x, 'discount_type')} · ${value(x, 'value')}${value(x, 'discount_type') === 'percent' ? '%' : ''}`,
                  value(x, 'applies_to'),
                  `${displayDate(x.valid_from)} – ${displayDate(x.valid_to)}`,
                  `${value(x, 'used_count', '0')}${x.usage_limit ? ` / ${value(x, 'usage_limit')}` : ''}`,
                  x.active ? 'Active' : 'Inactive',
                  <Button key="apply" tone="white" onClick={() => openModal('applyDiscount', x)}>
                    Apply to Fee
                  </Button>,
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  else if (path === '/admin/late-fees')
    content = (
      <>
        {toolbar(
          'Late Fee Automation',
          'Configure and apply automatic late fees on overdue payments.',
          <div className="flex gap-2">
            <Button tone="amber" onClick={() => void sendNow('/late-fees/apply-now')}>
              Apply Now
            </Button>
            {buttonOpen('late', 'Add Rule')}
          </div>,
        )}
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr_2fr]">
          <Stat label="Overdue Fee Records" amount={numeric(data.stats as FinanceData, 'overdue')} color="red" />
          <Stat label="Active Rules" amount={numeric(data.stats as FinanceData, 'active_rules')} color="amber" />
          <div className="grid place-items-center rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-5 text-center text-white">
            <p className="font-semibold">Late fees are applied once per overdue fee per day when you select Apply Now.</p>
          </div>
        </div>
        <Panel title={`Late Fee Rules (${items.length})`} icon="list">
          {table(
            ['Rule Name', 'Calculation', 'Grace Days', 'Maximum Cap', 'Status', 'Actions'],
            items,
            'No rules configured. Add a late fee rule to automatically charge penalties on overdue fees.',
            x => (
              <>
                {[
                  value(x, 'name'),
                  `${value(x, 'rule_type')} · ${rupees(x.amount)}`,
                  value(x, 'grace_days'),
                  x.max_cap ? rupees(x.max_cap) : 'No cap',
                  x.active ? 'Active' : 'Inactive',
                  <span key="apply" className="text-sm text-slate-500">
                    Apply Now runs this rule
                  </span>,
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  else if (path === '/admin/payment-reminders')
    content = (
      <>
        {toolbar(
          'Payment Reminder Automation',
          'Automatically queue in-app fee reminders for students.',
          <div className="flex gap-2">
            <Button tone="white" onClick={() => navigate('/admin/integrations')}>
              Configure Channels
            </Button>
            <Button onClick={() => void sendNow('/reminders/send-now')}>Send All Now</Button>
            {buttonOpen('reminder', 'Add Reminder Rule')}
          </div>,
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Active Rules" amount={numeric(data.stats as FinanceData, 'active_rules')} />
          <Stat label="Sent This Month" amount={numeric(data.stats as FinanceData, 'sent_month')} color="green" />
          <Stat label="Total Sent" amount={numeric(data.stats as FinanceData, 'total_sent')} color="cyan" />
          <Stat label="Overdue Fees" amount={numeric(data.stats as FinanceData, 'overdue')} color="red" />
        </div>
        <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <b>Channel Status:</b>
          {['Email', 'SMS', 'WhatsApp'].map(x => (
            <span key={x} className="text-sm text-slate-600">
              {x} <b className="ml-2 rounded-full bg-slate-100 px-3 py-1 text-slate-500">Off</b>
            </span>
          ))}
          <span className="text-sm text-emerald-700">In-App Active</span>
        </div>
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Reminder Rules" icon="bell">
            {items.length ? (
              items.map(x => (
                <article key={value(x, 'id')} className="border-b p-4">
                  <b>{value(x, 'name')}</b>
                  <p className="mt-1 text-sm text-slate-500">
                    {value(x, 'trigger')} · {value(x, 'days')} days · {value(x, 'send_time')}
                  </p>
                </article>
              ))
            ) : (
              <Empty title="No reminder rules yet." detail="Create automated reminders to collect fees on time." />
            )}
          </Panel>
          <Panel title="Recent Activity" icon="event">
            {((data.activity as FinanceItem[] | undefined) || []).length ? (
              ((data.activity as FinanceItem[]) || []).map(x => (
                <div key={value(x, 'id')} className="border-b p-3 text-sm">
                  <b>{value(x, 'student_name', 'Student')}</b>
                  <p className="text-slate-500">
                    {value(x, 'channel')} · {value(x, 'status')} · {displayDate(x.sent_at)}
                  </p>
                </div>
              ))
            ) : (
              <Empty title="No reminders sent yet" />
            )}
          </Panel>
        </div>
      </>
    );
  else if (path === '/admin/deletion-audit')
    content = (
      <>
        {toolbar('Fee Deletion Audit Log', 'Immutable record of every reversed fee payment — never edited, never removed.')}
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This log is read-only and tamper-proof. Every entry is retained in the server audit tables.
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            ['Total Deletions', 'total', 'red'],
            ['This Month', 'thisMonth', 'amber'],
            ['Total Principal Deleted', 'principal', 'blue'],
            ['Total Net Reversed', 'net', 'violet'],
            ['Fine Reversed', 'fine', 'red'],
          ].map(([label, key, color]) => (
            <Stat
              key={key}
              label={label}
              amount={key === 'total' || key === 'thisMonth' ? numeric(stats, key) : rupees(stats[key])}
              color={color}
            />
          ))}
        </div>
        <Panel title="Reversed Payments" icon="shield">
          {table(
            ['Student Name / Adm#', 'Deleted By', 'Date', 'Method', 'Principal', 'Net Reversed', 'Fine Reversed', 'Reason'],
            items,
            'No deletions recorded. No fee payments have been reversed yet.',
            x => (
              <>
                {[
                  <>
                    <b>{value(x, 'student_name', 'Student')}</b>
                    <small className="block">Adm: {value(x, 'admission_number', '—')}</small>
                  </>,
                  value(x, 'deleted_by'),
                  displayDate(x.deleted_at),
                  value((x.payment_snapshot as FinanceItem | undefined), 'method'),
                  rupees(x.principal),
                  rupees(x.net_reversed),
                  rupees(x.fine_reversed),
                  value(x, 'reason'),
                ].map((v, i) => (
                  <td key={i} className="px-3 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  else if (path === '/admin/accounting-export')
    content = (
      <>
        {toolbar('Accounting / Tally Export', 'Export fee collection and payroll data for Tally, QuickBooks or Excel.')}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Total Fees Collected" amount={rupees((data.stats as FinanceData | undefined)?.collected)} color="green" />
          <Stat label="Fees This Month" amount={rupees((data.stats as FinanceData | undefined)?.month_total)} />
          <Stat label="Total Payroll Paid" amount={rupees(0)} color="cyan" />
          <Stat label="Payroll This Month" amount={rupees(0)} color="amber" />
        </div>
        <div className="grid gap-5 xl:grid-cols-3">
          {[
            ['fees', 'Fee Collection Export', 'Export fee payments with principal, fine, discount and net collected breakdown.'],
            ['payroll', 'Payroll Expense Export', 'Export payroll expense data for the selected date range.'],
            ['defaulters', 'Fee Defaulters Export', 'Download students with pending, partial or overdue fee balances.'],
          ].map(([kind, title, description]) => (
            <Panel key={kind} title={title} icon="export">
              <div className="space-y-4 p-5">
                <p className="text-sm text-slate-600">{description}</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="From Date">
                    <input
                      id={`${kind}-from`}
                      type="date"
                      className={inputClass}
                      defaultValue={`${today().slice(0, 4)}-01-01`}
                    />
                  </Field>
                  <Field label="To Date">
                    <input id={`${kind}-to`} type="date" className={inputClass} defaultValue={today()} />
                  </Field>
                </div>
                <Field label="Format">
                  <select id={`${kind}-format`} className={inputClass}>
                    <option value="standard">Standard CSV (Excel / QuickBooks)</option>
                    <option value="tally">Tally Import CSV</option>
                  </select>
                </Field>
                <Button
                  onClick={() => {
                    const from = (document.getElementById(`${kind}-from`) as HTMLInputElement).value,
                      to = (document.getElementById(`${kind}-to`) as HTMLInputElement).value,
                      format = (document.getElementById(`${kind}-format`) as HTMLSelectElement).value;
                    void financeDownload(`/export?kind=${kind}&format=${format}&from=${from}&to=${to}`).catch(e =>
                      showNotice('error', String(e)),
                    );
                  }}
                >
                  <AdminIcon name="download" className="h-4 w-4" />
                  Download {kind === 'fees' ? 'Fee Collection' : kind === 'payroll' ? 'Payroll Expense' : 'Defaulters List'}
                </Button>
              </div>
            </Panel>
          ))}
        </div>
        <Panel title="How to Import into Tally" icon="book">
          <ol className="grid gap-4 p-5 text-sm text-slate-600 md:grid-cols-4">
            {[
              'Choose Tally Import CSV format and download the file.',
              'Open Tally ERP 9 or TallyPrime and open your company.',
              'Go to Gateway of Tally → Import Data → Vouchers and select the CSV.',
              'Verify ledger names against your chart of accounts.',
            ].map((x, i) => (
              <li key={x}>
                <b className="mr-2 text-orange-600">{i + 1}</b>
                {x}
              </li>
            ))}
          </ol>
        </Panel>
      </>
    );
  else if (path === '/admin/expenses' || path === '/admin/income') {
    const isIncome = path === '/admin/income';
    content = (
      <>
        {toolbar(
          isIncome ? 'Income' : 'Expenses',
          isIncome ? 'Track direct income received by the institute.' : 'Record and review institute expenses.',
          <Button onClick={() => navigate(`/admin/${isIncome ? 'income' : 'expenses'}/new`)}>
            <AdminIcon name="plus" className="h-4 w-4" />
            {isIncome ? 'Record Income' : 'Record Expense'}
          </Button>,
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Stat label={isIncome ? 'Total Income' : 'Total Expenses'} amount={rupees(stats.total)} color={isIncome ? 'green' : 'red'} />
          <Stat label="This Month" amount={rupees(stats.month)} color="blue" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <input
            className={`${inputClass} max-w-lg`}
            placeholder={`Search ${isIncome ? 'income' : 'expenses'}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Panel title={isIncome ? 'Income Records' : 'Expense Records'} icon={isIncome ? 'trend' : 'calculator'}>
          {table(
            ['Date', 'Title / Particulars', 'Head', 'Amount', 'Payment Mode', 'Reference'],
            items,
            isIncome ? 'No income records found.' : 'No expense records found.',
            x => (
              <>
                {[
                  displayDate(isIncome ? x.received_on : x.spent_on),
                  value(x, 'title'),
                  value(x, 'head_name', '—'),
                  rupees(x.amount),
                  value(x, 'method'),
                  value(x, 'reference', '—'),
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  } else if (path === '/admin/expense-heads' || path === '/admin/income-heads') {
    const isIncome = path === '/admin/income-heads';
    content = (
      <>
        {toolbar(
          isIncome ? 'Income Heads' : 'Expense Heads',
          `Manage categories for branch-wise ${isIncome ? 'income' : 'expense'} tracking.`,
          <Button
            onClick={() => {
              updateForm('headGroup', isIncome ? 'income' : 'expense');
              openModal('head');
            }}
          >
            <AdminIcon name="plus" className="h-4 w-4" />
            Add {isIncome ? 'Income' : 'Expense'} Head
          </Button>,
        )}
        <Panel title={`${isIncome ? 'Income' : 'Expense'} Categories`} icon="list">
          {table(
            ['Category Name', 'Description', 'Branch', 'Status', 'Actions'],
            items,
            `No ${isIncome ? 'income' : 'expense'} heads defined yet.`,
            x => (
              <>
                {[
                  value(x, 'name'),
                  value(x, 'description', '—'),
                  'Consolidated (All Branches)',
                  x.active ? 'Active' : 'Inactive',
                  '—',
                ].map((v, i) => (
                  <td key={i} className="px-4 py-3">
                    {v}
                  </td>
                ))}
              </>
            ),
          )}
        </Panel>
      </>
    );
  } else if (path === '/admin/expenses/new' || path === '/admin/income/new') {
    const isIncome = path === '/admin/income/new';
    content = (
      <>
        {toolbar(
          isIncome ? 'Record Income' : 'Record Expense',
          `Enter details of ${isIncome ? 'direct income received' : 'an expense paid'} by the institute.`,
          <Button tone="white" onClick={() => navigate(`/admin/${isIncome ? 'income' : 'expenses'}`)}>
            Back to {isIncome ? 'Income' : 'Expenses'} List
          </Button>,
        )}
        <form onSubmit={submit} className="mx-auto max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-5 md:grid-cols-2">
            <Field label={`${isIncome ? 'Income' : 'Expense'} Category / Head *`}>
              <select
                required
                className={inputClass}
                value={form.headId || ''}
                onChange={e => updateForm('headId', e.target.value)}
              >
                <option value="">-- Select {isIncome ? 'Income' : 'Expense'} Category --</option>
                {((data.items as FinanceItem[] | undefined) || []).map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Title / Particulars *">
              <input
                required
                className={inputClass}
                value={form.title || ''}
                onChange={e => updateForm('title', e.target.value)}
                placeholder={isIncome ? 'e.g. CSR Grant Payment, Hall Rent Received' : 'e.g. Classroom supplies'}
              />
            </Field>
            <Field label="Amount (₹) *">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
                value={form.amount || ''}
                onChange={e => updateForm('amount', e.target.value)}
              />
            </Field>
            <Field label={isIncome ? 'Date Received *' : 'Date Paid *'}>
              <input
                required
                type="date"
                className={inputClass}
                value={form.date || today()}
                onChange={e => updateForm('date', e.target.value)}
              />
            </Field>
            <Field label="Payment Mode *">
              <select
                className={inputClass}
                value={form.method || 'cash'}
                onChange={e => updateForm('method', e.target.value)}
              >
                {['cash', 'upi', 'bank transfer', 'card', 'cheque', 'online'].map(x => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Receipt / Reference No. (Optional)">
              <input
                className={inputClass}
                value={form.reference || ''}
                onChange={e => updateForm('reference', e.target.value)}
              />
            </Field>
            <Field label="Notes / Description (Optional)" className="md:col-span-2">
              <textarea
                rows={4}
                className={inputClass}
                value={form.notes || ''}
                onChange={e => updateForm('notes', e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end gap-3 border-t pt-5">
            <Button tone="white" onClick={() => navigate(`/admin/${isIncome ? 'income' : 'expenses'}`)}>
              Cancel
            </Button>
            <Button type="submit" tone="green" disabled={saving}>
              Save {isIncome ? 'Income' : 'Expense'}
            </Button>
          </div>
        </form>
      </>
    );
  } else content = <Empty title="This Finance page is not available." />;

  const structureOptions = (data.items as FinanceItem[] | undefined) || [];

  return (
    <main className="space-y-5 pb-8">
      {path === '/admin/fees' &&
        tab !== 'templates' &&
        toolbar(
          pageTitle,
          'Manage dues, record collections and reconcile fee receipts.',
          <div className="flex flex-wrap gap-2">
            <Button tone="white" onClick={() => void financeDownload('/export?kind=fees').catch(e => showNotice('error', String(e)))}>
              Export Ledger
            </Button>
            <Button tone="white" onClick={() => setModal('import')}>
              Import CSV
            </Button>
            <Button tone="white" onClick={() => navigate('/admin/fees/report')}>
              View Report
            </Button>
            <Button onClick={() => void sendNow('/reminders/send-now')}>Send Reminders</Button>
          </div>,
        )}
      {path === '/admin/fees/report' &&
        toolbar(
          pageTitle,
          'Review fee collections and export the receipt ledger.',
          <Button tone="white" onClick={() => void financeDownload('/export?kind=fees').catch(e => showNotice('error', String(e)))}>
            Export CSV
          </Button>,
        )}
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
            notice.kind === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {notice.text}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-white p-4 text-rose-800">
          <span>{error}</span>
          <Button
            tone="white"
            onClick={() => {
              invalidateFinanceCache();
              setRefresh(x => x + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
      {loading && !Object.keys(data).length ? (
        <div className="space-y-4" aria-label="Loading Finance">
          <div className="h-10 w-1/3 animate-pulse rounded bg-slate-200" />
          <div className="grid gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map(x => (
              <div key={x} className="h-28 animate-pulse rounded-2xl bg-white" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : (
        content
      )}

      {/* TASK 2: Assign Fee to Selective Students */}
      {modal === 'assignStudents' && (
        <Dialog title="Assign Fee to Selective Students" onClose={closeModal}>
          <form onSubmit={handleAssignStudentsSubmit} className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {modalError}
              </div>
            )}
            <Field label="Fee Template Structure *">
              <select
                required
                className={inputClass}
                value={selectedStructureId}
                onChange={e => handleStructureSelectChange(e.target.value)}
              >
                <option value="">Select structure...</option>
                {structureOptions.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'title')} · {rupees(x.total_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <MultiSelect
              label="Filter Students by Batch"
              placeholder="All Batches (or filter by specific batches)..."
              options={batchOptions}
              selected={selectedFilterBatches}
              onChange={setSelectedFilterBatches}
              allOptionLabel="All Batches"
            />

            <MultiSelect
              label="Students"
              required
              placeholder="Search & select students..."
              searchPlaceholder="Search by name, roll no, or phone..."
              options={studentOptions}
              selected={selectedStudents}
              onChange={setSelectedStudents}
              showSelectAll
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic Session Year">
                <select
                  className={inputClass}
                  value={selectedSessionYear}
                  onChange={e => setSelectedSessionYear(e.target.value)}
                >
                  {sessionYears.map(yr => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Override Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={overrideDueDate}
                  onChange={e => setOverrideDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Assigning...' : 'Assign to Selective Students'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* TASK 3: Assign Fee Structure to Batch */}
      {modal === 'assignBatch' && (
        <Dialog title="Assign Fee Structure to Batch" onClose={closeModal}>
          <form onSubmit={handleAssignBatchSubmit} className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {modalError}
              </div>
            )}
            <Field label="Fee Template Structure *">
              <select
                required
                className={inputClass}
                value={selectedStructureId}
                onChange={e => handleStructureSelectChange(e.target.value)}
              >
                <option value="">Select structure...</option>
                {structureOptions.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'title')} · {rupees(x.total_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <MultiSelect
              label="Select Batch(es)"
              required
              placeholder="Search & select batch(es)..."
              searchPlaceholder="Search batches..."
              options={batchOptions}
              selected={selectedBatches}
              onChange={setSelectedBatches}
              showSelectAll
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic Session Year">
                <select
                  className={inputClass}
                  value={selectedSessionYear}
                  onChange={e => setSelectedSessionYear(e.target.value)}
                >
                  {sessionYears.map(yr => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Override First Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={overrideDueDate}
                  onChange={e => setOverrideDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Assigning...' : 'Assign to Batch'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* TASK 4: Assign Fee by Subject */}
      {modal === 'assignSubject' && (
        <Dialog title="Assign Fee by Subject" onClose={closeModal}>
          <form onSubmit={handleAssignSubjectSubmit} className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {modalError}
              </div>
            )}
            <Field label="Fee Template Structure *">
              <select
                required
                className={inputClass}
                value={selectedStructureId}
                onChange={e => handleStructureSelectChange(e.target.value)}
              >
                <option value="">Select structure...</option>
                {structureOptions.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'title')} · {rupees(x.total_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <MultiSelect
              label="Subject(s)"
              required
              placeholder="Search & select subject(s)..."
              searchPlaceholder="Search subjects (Physics, Chemistry, Maths...)"
              options={subjectOptions}
              selected={selectedSubjects}
              onChange={setSelectedSubjects}
              showSelectAll
            />

            <MultiSelect
              label="Batches (Optional)"
              placeholder="All Batches (or filter by specific batches)..."
              options={batchOptions}
              selected={selectedBatches}
              onChange={setSelectedBatches}
              showSelectAll
            />

            <MultiSelect
              label="Students (Optional)"
              placeholder="All students in selected subject/batch (or select specific)..."
              options={studentOptions}
              selected={selectedStudents}
              onChange={setSelectedStudents}
              showSelectAll
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic Session Year">
                <select
                  className={inputClass}
                  value={selectedSessionYear}
                  onChange={e => setSelectedSessionYear(e.target.value)}
                >
                  {sessionYears.map(yr => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Override Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={overrideDueDate}
                  onChange={e => setOverrideDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Assigning...' : 'Assign Fee by Subject'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* TASK 6: Edit Fee Modal */}
      {modal === 'editFee' && selected && (
        <Dialog title="Edit / Assign Student Fee" onClose={closeModal}>
          <form onSubmit={handleEditFeeSubmit} className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {modalError}
              </div>
            )}
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b className="text-base text-slate-800">{value(selected, 'student_name')}</b>
                  <p className="text-xs text-slate-500">
                    Adm No: {value(selected, 'admission_number', '—')} · Batch: {value(selected, 'batch_name', '—')}
                  </p>
                </div>
                <div className="text-right text-xs">
                  <span className="block text-slate-500">Already Paid: <b className="text-emerald-700">{rupees(selected.paid)}</b></span>
                  <span className="block text-slate-500">Current Balance: <b className="text-rose-600">{rupees(selected.balance)}</b></span>
                </div>
              </div>
              {Number(selected.paid) > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  ℹ Prior payments and receipts ({rupees(selected.paid)}) will remain completely untouched. Changing the total amount will recalculate the remaining balance.
                </p>
              )}
            </div>

            <Field label="Change Fee Template Structure (Optional)">
              <select
                className={inputClass}
                value={selectedStructureId}
                onChange={e => handleStructureSelectChange(e.target.value)}
              >
                <option value="">Keep / Custom structure</option>
                {structureOptions.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'title')} · {rupees(x.total_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fee Particular Title *">
                <input
                  required
                  className={inputClass}
                  value={editFeeTitle}
                  onChange={e => setEditFeeTitle(e.target.value)}
                  placeholder="e.g. Tuition Fee - Monthly"
                />
              </Field>
              <Field label="Total Amount (₹) *">
                <input
                  required
                  type="number"
                  min={Number(selected.paid) || 0.01}
                  step="0.01"
                  className={inputClass}
                  value={editFeeAmount}
                  onChange={e => setEditFeeAmount(e.target.value)}
                />
              </Field>
            </div>

            <MultiSelect
              label="Subject(s)"
              placeholder="Select enrolled subject(s)..."
              options={subjectOptions}
              selected={selectedSubjects}
              onChange={setSelectedSubjects}
              showSelectAll
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic Session Year">
                <select
                  className={inputClass}
                  value={selectedSessionYear}
                  onChange={e => setSelectedSessionYear(e.target.value)}
                >
                  {sessionYears.map(yr => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={overrideDueDate}
                  onChange={e => setOverrideDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {/* TASK 6: Assign Fee to Unassigned Student */}
      {modal === 'assignStudentSingle' && selected && (
        <Dialog title="Assign Fee to Student" onClose={closeModal}>
          <form onSubmit={handleAssignStudentSingleSubmit} className="space-y-4">
            {modalError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {modalError}
              </div>
            )}
            <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
              <b className="text-base text-slate-800">{value(selected, 'student_name')}</b>
              <p className="mt-0.5 text-xs text-slate-500">
                Adm No: {value(selected, 'admission_number', '—')} · Batch: {value(selected, 'batch_name', '—')}
              </p>
            </div>

            <Field label="Fee Template Structure *">
              <select
                required
                className={inputClass}
                value={selectedStructureId}
                onChange={e => handleStructureSelectChange(e.target.value)}
              >
                <option value="">Select structure...</option>
                {structureOptions.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'title')} · {rupees(x.total_amount)}
                  </option>
                ))}
              </select>
            </Field>

            <MultiSelect
              label="Subject(s) (Optional)"
              placeholder="Select subject(s)..."
              options={subjectOptions}
              selected={selectedSubjects}
              onChange={setSelectedSubjects}
              showSelectAll
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Academic Session Year">
                <select
                  className={inputClass}
                  value={selectedSessionYear}
                  onChange={e => setSelectedSessionYear(e.target.value)}
                >
                  {sessionYears.map(yr => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Override Due Date">
                <input
                  type="date"
                  className={inputClass}
                  value={overrideDueDate}
                  onChange={e => setOverrideDueDate(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Assigning...' : 'Assign Fee'}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'import' && (
        <Dialog title="Import Fee Receipts CSV" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-slate-600">
              CSV columns: <code>student_id</code> or <code>admission_number</code>, <code>amount</code>, and{' '}
              <code>payment_date</code> (YYYY-MM-DD). Files up to 2 MB are accepted.
            </p>
            <Field label="CSV File *">
              <input
                required
                type="file"
                accept=".csv,text/csv"
                className={inputClass}
                onChange={event => setCsvFile(event.target.files?.[0] || null)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !csvFile}>
                Import Receipts
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'collect' && (
        <Dialog title="Collect Payment" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <div className="rounded-xl bg-orange-50 p-4">
              <b>{value(selected || undefined, 'student_name')}</b>
              <p className="mt-1 text-sm text-slate-500">
                {value(selected || undefined, 'title')} · Balance {rupees(selected?.balance)}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount (₹) *">
                <input
                  required
                  type="number"
                  min="0.01"
                  max={Number(selected?.balance) || undefined}
                  step="0.01"
                  className={inputClass}
                  value={form.amount || ''}
                  onChange={e => updateForm('amount', e.target.value)}
                />
              </Field>
              <Field label="Payment Date *">
                <input
                  required
                  type="date"
                  className={inputClass}
                  value={form.paidAt || today()}
                  onChange={e => updateForm('paidAt', e.target.value)}
                />
              </Field>
              <Field label="Payment Method *">
                <select
                  className={inputClass}
                  value={form.method || 'cash'}
                  onChange={e => updateForm('method', e.target.value)}
                >
                  {['cash', 'upi', 'bank transfer', 'card', 'cheque', 'online'].map(x => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Reference No.">
                <input
                  className={inputClass}
                  value={form.reference || ''}
                  onChange={e => updateForm('reference', e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Record Payment
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'ledger' && (
        <Dialog title="Student Fee Ledger" onClose={closeModal}>
          <div className="rounded-xl bg-orange-50 p-4">
            <b>{value(selected || undefined, 'student_name')}</b>
            <p className="text-sm text-slate-500">
              Adm: {value(selected || undefined, 'admission_number', '—')} · {value(selected || undefined, 'title')}
            </p>
          </div>
          <div className="mt-4 divide-y">
            {((data.ledger as FinanceItem[] | undefined) || []).length ? (
              ((data.ledger as FinanceItem[]) || []).map(x => (
                <div key={value(x, 'id')} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <b>{rupees(x.amount)}</b>
                    <small className="ml-2 text-slate-500">
                      {value(x, 'method')} · {displayDate(x.paid_at)} · {value(x, 'receipt_no')}
                    </small>
                    {x.reversed_at && <em className="ml-2 text-xs text-rose-700">Reversed</em>}
                  </span>
                  {!x.reversed_at && (
                    <Button
                      tone="red"
                      onClick={() => {
                        setSelected(x);
                        setModal('reverse');
                      }}
                    >
                      Reverse
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <Empty title="No payments recorded for this fee yet." />
            )}
          </div>
        </Dialog>
      )}

      {modal === 'reverse' && (
        <Dialog title="Reverse Fee Payment" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              This creates an immutable audit entry and marks the payment as reversed.
            </p>
            <Field label="Reason for reversal *">
              <textarea
                required
                minLength={3}
                className={inputClass}
                rows={3}
                value={form.reason || ''}
                onChange={e => updateForm('reason', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={() => setModal('ledger')}>
                Cancel
              </Button>
              <Button type="submit" tone="red" disabled={saving}>
                Reverse Payment
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'structure' && (
        <Dialog title="Create Fee Structure Template" onClose={closeModal}>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Title *">
              <input
                required
                className={inputClass}
                value={form.title || ''}
                onChange={e => updateForm('title', e.target.value)}
              />
            </Field>
            <Field label="Fee Type">
              <select
                className={inputClass}
                value={form.feeTypeId || ''}
                onChange={e => updateForm('feeTypeId', e.target.value)}
              >
                {lookups.feeTypes.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Total Amount (₹) *">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
                value={form.amount || ''}
                onChange={e => updateForm('amount', e.target.value)}
              />
            </Field>
            <Field label="Frequency">
              <select
                className={inputClass}
                value={form.frequency || 'one-time'}
                onChange={e => updateForm('frequency', e.target.value)}
              >
                {['one-time', 'monthly', 'quarterly', 'annual', 'custom'].map(x => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Scope">
              <select
                className={inputClass}
                value={form.scope || 'global'}
                onChange={e => updateForm('scope', e.target.value)}
              >
                {['global', 'batch', 'student'].map(x => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </Field>
            <Field label="Academic Session Year">
              <select
                className={inputClass}
                value={form.academicYearId || selectedSessionYear}
                onChange={e => {
                  updateForm('academicYearId', e.target.value);
                  setSelectedSessionYear(e.target.value);
                }}
              >
                {sessionYears.map(yr => (
                  <option key={yr} value={yr}>
                    {yr}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Due Date">
              <input
                type="date"
                className={inputClass}
                value={form.dueDate || ''}
                onChange={e => updateForm('dueDate', e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <input
                className={inputClass}
                value={form.notes || ''}
                onChange={e => updateForm('notes', e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={form.mandatoryEnrollment === 'true'}
                onChange={e => updateForm('mandatoryEnrollment', String(e.target.checked))}
              />
              Mandatory Billing Enrollment
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save Structure
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'discount' && (
        <Dialog title="New Discount" onClose={closeModal}>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            {[
              ['Name *', 'name'],
              ['Coupon Code *', 'code'],
              ['Value *', 'value'],
              ['Applies To', 'appliesTo'],
              ['Valid From', 'validFrom'],
              ['Valid To', 'validTo'],
              ['Usage Limit', 'usageLimit'],
            ].map(([label, key]) => (
              <Field key={key} label={label}>
                <input
                  required={label.includes('*')}
                  type={
                    key === 'validFrom' || key === 'validTo'
                      ? 'date'
                      : key === 'value' || key === 'usageLimit'
                      ? 'number'
                      : 'text'
                  }
                  min={key === 'value' || key === 'usageLimit' ? '0.01' : undefined}
                  step={key === 'value' ? '0.01' : undefined}
                  className={inputClass}
                  value={form[key] || ''}
                  onChange={e => updateForm(key, e.target.value)}
                />
              </Field>
            ))}
            <Field label="Type">
              <select className={inputClass} value={form.type || 'percent'} onChange={e => updateForm('type', e.target.value)}>
                <option value="percent">Percentage</option>
                <option value="flat">Flat amount</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save Discount
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'applyDiscount' && selected && (
        <Dialog title="Apply Discount to Fee" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <p className="rounded-xl bg-orange-50 p-4 text-sm">
              Select an eligible discount to apply to <b>{value(selected || undefined, 'student_name')}</b> ·{' '}
              {value(selected || undefined, 'title')}
            </p>
            <Field label="Discount">
              <select
                required
                className={inputClass}
                value={form.discountId || ''}
                onChange={e => updateForm('discountId', e.target.value)}
              >
                <option value="">Select discount</option>
                {items.map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')} ({value(x, 'code')})
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Apply Discount</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'late' && (
        <Dialog title="Add Late Fee Rule" onClose={closeModal}>
          <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
            <Field label="Rule Name *">
              <input
                required
                className={inputClass}
                value={form.name || ''}
                onChange={e => updateForm('name', e.target.value)}
              />
            </Field>
            <Field label="Calculation Type">
              <select className={inputClass} value={form.type || 'fixed'} onChange={e => updateForm('type', e.target.value)}>
                <option value="fixed">Fixed Amount</option>
                <option value="percent">Percentage</option>
              </select>
            </Field>
            <Field label="Amount *">
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
                value={form.amount || ''}
                onChange={e => updateForm('amount', e.target.value)}
              />
            </Field>
            <Field label="Grace Days">
              <input
                type="number"
                min="0"
                max="365"
                className={inputClass}
                value={form.graceDays || '0'}
                onChange={e => updateForm('graceDays', e.target.value)}
              />
            </Field>
            <Field label="Maximum Cap">
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={inputClass}
                value={form.maxCap || ''}
                onChange={e => updateForm('maxCap', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Save Rule</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'reminder' && (
        <Dialog title="Add Reminder Rule" onClose={closeModal} width="max-w-4xl">
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
            <Field label="Rule Name *">
              <input
                required
                className={inputClass}
                value={form.name || ''}
                onChange={e => updateForm('name', e.target.value)}
              />
            </Field>
            <Field label="Send Time">
              <input
                type="time"
                className={inputClass}
                value={form.sendTime || '09:00'}
                onChange={e => updateForm('sendTime', e.target.value)}
              />
            </Field>
            <Field label="Trigger">
              <select
                className={inputClass}
                value={form.trigger || 'before_due'}
                onChange={e => updateForm('trigger', e.target.value)}
              >
                <option value="before_due">Before Due Date</option>
                <option value="on_due">On Due Date</option>
                <option value="after_due">After Due Date</option>
              </select>
            </Field>
            <Field label="Days">
              <input
                type="number"
                min="0"
                max="365"
                className={inputClass}
                value={form.days || '3'}
                onChange={e => updateForm('days', e.target.value)}
              />
            </Field>
            <Field label="Channels (In-App only until integrations are configured)" className="md:col-span-2">
              <select
                className={inputClass}
                value={form.channels || 'in_app'}
                onChange={e => updateForm('channels', e.target.value)}
              >
                <option value="in_app">In-App</option>
                <option value="email">Email — configure first</option>
                <option value="sms">SMS — configure first</option>
                <option value="whatsapp">WhatsApp — configure first</option>
              </select>
            </Field>
            <Field label="Available variables" className="md:col-span-2">
              <div className="flex flex-wrap gap-2 text-xs text-orange-600">
                {'{{student_name}} {{amount_due}} {{fee_title}} {{due_date}} {{institute_name}} {{overdue_days}}'
                  .split(' ')
                  .map(x => (
                    <code key={x} className="rounded bg-orange-50 px-2 py-1 text-orange-800">
                      {x}
                    </code>
                  ))}
              </div>
            </Field>
            <Field label="Email Subject">
              <input
                className={inputClass}
                value={form.emailSubject || ''}
                onChange={e => updateForm('emailSubject', e.target.value)}
              />
            </Field>
            <Field label="Email Body">
              <textarea
                rows={3}
                className={inputClass}
                value={form.emailBody || ''}
                onChange={e => updateForm('emailBody', e.target.value)}
              />
            </Field>
            <Field label="SMS Template (Max 160 chars)">
              <textarea
                maxLength={160}
                rows={3}
                className={inputClass}
                value={form.smsTemplate || ''}
                onChange={e => updateForm('smsTemplate', e.target.value)}
              />
              <small className="text-slate-500">{(form.smsTemplate || '').length}/160 characters</small>
            </Field>
            <Field label="WhatsApp Message">
              <textarea
                rows={3}
                className={inputClass}
                value={form.whatsappTemplate || ''}
                onChange={e => updateForm('whatsappTemplate', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Save Reminder Rule</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'emiPlan' && (
        <Dialog title="New EMI Plan" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Plan Name *">
              <input
                required
                className={inputClass}
                value={form.name || ''}
                onChange={e => updateForm('name', e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Installments">
                <input
                  type="number"
                  min="2"
                  max="60"
                  className={inputClass}
                  value={form.installments || '4'}
                  onChange={e => updateForm('installments', e.target.value)}
                />
              </Field>
              <Field label="Interval Days">
                <input
                  type="number"
                  min="1"
                  max="365"
                  className={inputClass}
                  value={form.intervalDays || '30'}
                  onChange={e => updateForm('intervalDays', e.target.value)}
                />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Save Plan</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'assignEmi' && (
        <Dialog title="Assign Installment Plan to Student Fee" onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Student Fee *">
              <select
                required
                className={inputClass}
                value={form.studentFeeId || ''}
                onChange={e => updateForm('studentFeeId', e.target.value)}
              >
                <option value="">Select student fee</option>
                {((data.items as FinanceItem[] | undefined) || []).map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'student_name')} · {value(x, 'title')} · {rupees(x.balance)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="EMI Installments Option *">
              <select
                required
                className={inputClass}
                value={form.planId || ''}
                onChange={e => updateForm('planId', e.target.value)}
              >
                {(((data.emi as FinanceData | undefined)?.plans as FinanceItem[] | undefined) || []).map(x => (
                  <option key={value(x, 'id')} value={value(x, 'id')}>
                    {value(x, 'name')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="First Due Date *">
              <input
                type="date"
                required
                className={inputClass}
                value={form.firstDueDate || today()}
                onChange={e => updateForm('firstDueDate', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Split into Installments</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'head' && (
        <Dialog title={`Add ${form.headGroup === 'income' ? 'Income' : 'Expense'} Head`} onClose={closeModal}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Category Name *">
              <input
                required
                className={inputClass}
                value={form.name || ''}
                onChange={e => updateForm('name', e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={3}
                className={inputClass}
                value={form.description || ''}
                onChange={e => updateForm('description', e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button tone="white" onClick={closeModal}>
                Cancel
              </Button>
              <Button type="submit">Save Head</Button>
            </div>
          </form>
        </Dialog>
      )}

      {modal === 'typeManager' && (
        <Dialog title="Fee Type Category Manager" onClose={closeModal}>
          <p className="mb-4 text-sm text-slate-600">Default fee types are available as categories. Add a custom category below.</p>
          <form
            onSubmit={async e => {
              e.preventDefault();
              try {
                await financePost('/fee-types', {
                  name: form.name,
                  componentGroup: form.componentGroup || 'Other',
                  badgeColor: 'blue',
                });
                closeModal();
                setRefresh(x => x + 1);
              } catch (err) {
                showNotice('error', String(err));
              }
            }}
            className="space-y-4"
          >
            <Field label="Category Name *">
              <input
                required
                className={inputClass}
                value={form.name || ''}
                onChange={e => updateForm('name', e.target.value)}
              />
            </Field>
            <Field label="Component Group">
              <input
                className={inputClass}
                value={form.componentGroup || ''}
                onChange={e => updateForm('componentGroup', e.target.value)}
              />
            </Field>
            <div className="flex justify-end">
              <Button type="submit">Add Fee Type</Button>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}
