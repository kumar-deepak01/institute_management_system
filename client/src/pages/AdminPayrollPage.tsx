import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminIcon from '../components/AdminIcon';
import QRCode from 'qrcode';
import { payrollDownload, payrollGet, payrollWrite, type PayrollDashboard, type PayrollStaff } from '../services/payroll';

type Modal = 'run' | 'generation-result' | 'increment' | 'advance' | 'profile' | 'work' | 'adjustment' | 'detail' | 'history' | 'settle' | 'zoom' | 'view-calculation' | 'payment-details' | 'pay' | 'receipt' | '';
type Preview = { period: { key: string }; workingDays: number; records: (PayrollStaff & { eligible: boolean; warnings: string[] })[]; totals: { staff: number; gross: number; deductions: number; net: number } };
type GenerationResult = { run: { id: string; period: string; status: string; staffCount: number; grossTotal: number; deductionTotal: number; netTotal: number }; generated: number; skipped: Array<{ staffId: string; name: string; reason: string }> };
type Detail = { staff: Record<string, unknown>; payrollHistory: Array<Record<string, any>>; workRecords: Array<Record<string, any>>; compensationHistory: Array<Record<string, any>>; adjustments: Array<Record<string, any>> };
type RunDetail = { run: Record<string, any>; records: Array<Record<string, any>> };
type PayrollModel = 'monthly' | 'hourly' | 'per_class' | 'per_hour' | 'hybrid';

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const inr = (value: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value || 0));
const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50';
const modelLabel: Record<string, string> = { monthly: 'Monthly', hourly: 'Hourly', per_class: 'Per class', per_hour: 'Per teaching hour', hybrid: 'Hybrid' };

function ModalFrame({ title, children, onClose, wide = false, icon }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean; icon?: string }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-3 sm:p-6" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-hidden rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}>
        <header className="flex items-center justify-between bg-gradient-to-r from-orange-500 to-orange-600 px-5 py-4 text-white">
          <h2 className="flex items-center gap-2 text-lg font-black">
            {icon && <AdminIcon name={icon} className="h-5 w-5" />}
            {title}
          </h2>
          <button className="rounded-lg p-1 text-xl text-orange-100 hover:bg-white/15" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="max-h-[calc(92vh-64px)] overflow-y-auto p-5">{children}</div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, icon, tone = 'blue', hint }: { label: string; value: React.ReactNode; icon: string; tone?: string; hint?: string }) {
  const colors: Record<string,string> = { blue: 'bg-orange-50 text-orange-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', teal: 'bg-teal-50 text-teal-600' };
  return (
    <article className="flex min-w-0 items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${colors[tone] || colors.blue}`}>
        <AdminIcon name={icon} className="h-6 w-6"/>
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-black tracking-[.12em] text-slate-400">{label}</p>
        <p className="mt-1 truncate text-2xl font-black text-slate-900">{value}</p>
        {hint && <p className="truncate text-xs text-slate-500">{hint}</p>}
      </div>
    </article>
  );
}

function emptyProfile(staff: PayrollStaff | null, date: string): { model: PayrollModel; monthlyRate: string; hourlyRate: string; classRate: string; teachingHourRate: string; allowance: string; effectiveFrom: string; deductUnpaidAbsences: boolean; reason: string } {
  return { model: staff?.model || 'monthly', monthlyRate: String(staff?.monthlyRate || 0), hourlyRate: String(staff?.hourlyRate || 0), classRate: String(staff?.classRate || 0), teachingHourRate: String(staff?.teachingHourRate || 0), allowance: String(staff?.allowance || 0), effectiveFrom: date, deductUnpaidAbsences: false, reason: '' };
}

export default function AdminPayrollPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<PayrollDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<Modal>('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<PayrollStaff | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [runStaffSearch, setRunStaffSearch] = useState('');
  const [runError, setRunError] = useState('');
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [profile, setProfile] = useState(emptyProfile(null, `${year}-${String(month).padStart(2,'0')}-01`));
  const [advanceRecords, setAdvanceRecords] = useState<Array<Record<string,any>>>([]);
  const [workKind, setWorkKind] = useState('attendance');
  const [workStatus, setWorkStatus] = useState('present');
  const [paymentForm, setPaymentForm] = useState({
    paymentMode: 'both',
    accountHolderName: '',
    bankName: '',
    bankAccountNumber: '',
    ifscCode: '',
    branch: '',
    upiId: ''
  });

  const dashboardRequest = useRef(0);
  const period = `${year}-${String(month).padStart(2,'0')}`;

  const load = useCallback(async (fresh = false) => {
    const requestId = ++dashboardRequest.current;
    setLoading(true); setError('');
    try {
      const result = await payrollGet<PayrollDashboard>(`?month=${month}&year=${year}`, fresh);
      if (requestId !== dashboardRequest.current) return;
      setData(result);
      if (result.error) setError(result.error);
    } catch (cause) {
      if (requestId === dashboardRequest.current) setError(cause instanceof Error ? cause.message : 'Payroll could not be loaded.');
    } finally {
      if (requestId === dashboardRequest.current) setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { void load(); return () => { dashboardRequest.current += 1; }; }, [load]);

  const filteredStaff = useMemo(() => (data?.staff || []).filter(staff => {
    const text = `${staff.name} ${staff.employeeId} ${staff.email}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (typeFilter !== 'all' && staff.model !== typeFilter) return false;
    if (statusFilter === 'missing' && staff.profileSet) return false;
    if (statusFilter === 'pending' && !staff.pendingWorkRecords) return false;
    return true;
  }), [data, query, statusFilter, typeFilter]);

  function openProfile(staff: PayrollStaff) {
    setSelected(staff);
    setProfile(emptyProfile(staff, `${period}-01`));
    setModal('profile');
  }

  async function openDetail(staff: PayrollStaff) {
    setSelected(staff); setDetail(null); setModal('detail');
    try { setDetail(await payrollGet<Detail>(`/staff/${encodeURIComponent(staff.id)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Staff payroll details could not be loaded.'); setModal(''); }
  }

  function openCalculation(staff: PayrollStaff) {
    setSelected(staff);
    setModal('view-calculation');
  }

  function openPaymentDetails(staff: PayrollStaff) {
    setSelected(staff);
    setPaymentForm({
      paymentMode: staff.paymentDetails?.paymentMode || 'both',
      accountHolderName: staff.paymentDetails?.accountHolderName || staff.name || '',
      bankName: staff.paymentDetails?.bankName || '',
      bankAccountNumber: staff.paymentDetails?.bankAccountNumber || '',
      ifscCode: staff.paymentDetails?.ifscCode || '',
      branch: staff.paymentDetails?.branch || '',
      upiId: staff.paymentDetails?.upiId || ''
    });
    setModal('payment-details');
  }

  // Pay and Receipt State (Tasks 4 & 5)
  const [payMethod, setPayMethod] = useState<'Bank Transfer' | 'UPI'>('Bank Transfer');
  const [payTxnId, setPayTxnId] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payRemarks, setPayRemarks] = useState('');
  const [editBankInline, setEditBankInline] = useState(false);
  const [bankForm, setBankForm] = useState({ accountHolderName: '', bankName: '', bankAccountNumber: '', ifscCode: '', branch: '' });
  const [upiInput, setUpiInput] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [paying, setPaying] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);

  const generateQr = useCallback(async (vpa: string, staffName: string, amount: number, periodLabel: string) => {
    if (!vpa) { setQrCodeUrl(''); return; }
    try {
      const upiUri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(staffName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Salary ${periodLabel}`)}`;
      const url = await QRCode.toDataURL(upiUri, { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrCodeUrl(url);
    } catch (err) {
      console.error('QR generation error:', err);
      setQrCodeUrl('');
    }
  }, []);

  function openPay(staff: PayrollStaff) {
    setSelected(staff);
    setError('');
    const pref = staff.paymentDetails?.paymentMode === 'upi' ? 'UPI' : 'Bank Transfer';
    setPayMethod(pref);
    setPayTxnId('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayRemarks('');
    setEditBankInline(!staff.paymentDetails?.bankAccountNumber);
    setBankForm({
      accountHolderName: staff.paymentDetails?.accountHolderName || staff.name || '',
      bankName: staff.paymentDetails?.bankName || '',
      bankAccountNumber: staff.paymentDetails?.bankAccountNumber || '',
      ifscCode: staff.paymentDetails?.ifscCode || '',
      branch: staff.paymentDetails?.branch || '',
    });
    const vpa = staff.paymentDetails?.upiId || '';
    setUpiInput(vpa);
    const periodLabel = `${monthNames[(data?.period.month ?? 10) - 1]} ${data?.period.year ?? 2026}`;
    if (vpa) {
      void generateQr(vpa, staff.name, staff.netPay, periodLabel);
    } else {
      setQrCodeUrl('');
    }
    setModal('pay');
  }

  function openReceipt(staff: PayrollStaff, paymentOverride?: any) {
    setSelected(staff);
    const payment = paymentOverride || staff.payment || {};
    const periodLabel = `${monthNames[(data?.period.month ?? 10) - 1]} ${data?.period.year ?? 2026}`;
    setReceiptData({
      staff,
      payment,
      periodLabel,
      receiptNo: payment.receiptNo || `MJM-SAL-${data?.period.year || 2026}-${staff.employeeId || '001'}`,
      paymentDate: payment.paymentDate || staff.paidAt || new Date().toISOString().slice(0, 10),
      amount: payment.amount || staff.netPay || 0,
      paymentMethod: payment.paymentMethod || 'Bank Transfer',
      transactionId: payment.transactionId || '—',
      remarks: payment.remarks || '',
      paidBy: payment.paidBy || 'Institute Admin',
      accountHolderName: payment.accountHolderName || staff.paymentDetails?.accountHolderName || staff.name,
      bankName: payment.bankName || staff.paymentDetails?.bankName || '',
      accountMasked: payment.accountMasked || (staff.paymentDetails?.bankAccountNumber ? `•••• •••• ${staff.paymentDetails.bankAccountNumber.slice(-4)}` : '—'),
      ifscCode: payment.ifscCode || staff.paymentDetails?.ifscCode || '',
      upiId: payment.upiId || staff.paymentDetails?.upiId || '',
    });
    setModal('receipt');
  }

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!selected || !data) return;
    if (!payTxnId.trim()) {
      setError('Transaction / Reference number (UTR) is required.');
      return;
    }
    if (payMethod === 'Bank Transfer' && editBankInline && !bankForm.bankAccountNumber && !selected.paymentDetails?.bankAccountNumber) {
      setError('Please provide bank account number for Bank Transfer.');
      return;
    }
    if (payMethod === 'UPI' && !upiInput.trim() && !selected.paymentDetails?.upiId) {
      setError('Please provide UPI ID for UPI payment.');
      return;
    }

    setPaying(true);
    setError('');
    try {
      const res = await payrollWrite<{ ok: boolean; message: string; receiptNo: string; payment: any }>('/pay', 'POST', {
        staffId: selected.id,
        period: data.period.key,
        paymentMethod: payMethod,
        transactionId: payTxnId.trim(),
        paymentDate: payDate,
        remarks: payRemarks.trim(),
        accountHolderName: bankForm.accountHolderName,
        bankName: bankForm.bankName,
        bankAccountNumber: bankForm.bankAccountNumber,
        ifscCode: bankForm.ifscCode,
        branch: bankForm.branch,
        upiId: upiInput.trim(),
      });

      setNotice(res.message || 'Payment recorded successfully. Receipt generated.');

      const updatedStaff: PayrollStaff = {
        ...selected,
        isPaid: true,
        payrollStatus: 'settled',
        paidAt: payDate,
        payment: res.payment,
        hasPaymentDetails: true,
        paymentDetails: {
          ...selected.paymentDetails,
          accountHolderName: bankForm.accountHolderName || selected.paymentDetails?.accountHolderName,
          bankName: bankForm.bankName || selected.paymentDetails?.bankName,
          bankAccountNumber: bankForm.bankAccountNumber || selected.paymentDetails?.bankAccountNumber,
          ifscCode: bankForm.ifscCode || selected.paymentDetails?.ifscCode,
          branch: bankForm.branch || selected.paymentDetails?.branch,
          upiId: upiInput.trim() || selected.paymentDetails?.upiId,
        }
      };

      setData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          staff: prev.staff.map(s => s.id === selected.id ? updatedStaff : s)
        };
      });

      openReceipt(updatedStaff, res.payment);
    } catch (err: any) {
      setError(err.message || 'Payment could not be completed. Please retry.');
    } finally {
      setPaying(false);
    }
  }

  async function savePaymentDetails(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!paymentForm.bankAccountNumber && !paymentForm.upiId) {
      setError('Please provide either Bank Account or UPI details for payroll payouts.');
      return;
    }
    setSaving(true); setError('');
    try {
      await payrollWrite('/staff-payment-details', 'POST', {
        staffId: selected.id,
        ...paymentForm
      });
      setNotice(`Payment details saved for ${selected.name}.`);
      setModal('');
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment details could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function openAdvances() {
    setModal('advance');
    try { const result = await payrollGet<{ records: Array<Record<string,any>> }>('/advances', true); setAdvanceRecords(result.records); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Advances could not be loaded.'); }
  }

  async function openRunHistory(id: string) {
    setRunDetail(null); setModal('history');
    try { setRunDetail(await payrollGet<RunDetail>(`/runs/${encodeURIComponent(id)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Payroll history could not be loaded.'); setModal(''); }
  }

  const previewPayroll = useCallback(async (event?: FormEvent) => {
    event?.preventDefault(); setSaving(true); setRunError(''); setPreview(null);
    try {
      const result = await payrollWrite<Preview>('/runs/preview', 'POST', { period });
      setPreview(result);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : 'Payroll preview could not be calculated.');
    } finally {
      setSaving(false);
    }
  }, [period]);

  useEffect(() => {
    if (modal === 'run') {
      setRunError('');
      void previewPayroll();
    }
  }, [modal, previewPayroll]);

  async function generatePayroll() {
    if (!preview || saving) return;
    if (data?.run?.status === 'settled' && !window.confirm(`Payroll for ${monthNames[month-1]} ${year} has already been recorded as Settled. Recalculate and overwrite?`)) return;
    if (data?.run?.status === 'draft' && !window.confirm(`Recalculate the existing draft for ${monthNames[month-1]} ${year}? Selected staff payroll rows will be updated with the latest approved records.`)) return;
    setSaving(true); setRunError('');
    try {
      const result = await payrollWrite<GenerationResult>('/runs', 'POST', {
        period,
        staffIds: selectedStaffIds.length ? selectedStaffIds : undefined,
        includeStaffIds: selectedStaffIds.length ? selectedStaffIds : undefined,
        confirmWarnings: true,
        recalculate: data?.run?.status === 'draft',
        confirmSettledOverwrite: data?.run?.status === 'settled'
      });
      setGenerationResult(result);
      setModal('generation-result');
      setNotice(selectedStaffIds.length ? `Payroll snapshot generated for ${result.generated} selected staff.` : 'Draft payroll generated for all eligible staff.');
      await load(true);
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : 'Draft payroll could not be generated.');
    } finally {
      setSaving(false);
    }
  }

  async function transition(status: string, extra: Record<string,unknown> = {}) {
    if (!data?.run) return;
    const prompts: Record<string,string> = { approved: 'Approve the reviewed payroll snapshot?', finalized: 'Finalize and lock this payroll snapshot?', settled: 'Record this payroll as manually settled?' };
    if (!window.confirm(prompts[status] || 'Continue?')) return;
    setSaving(true); setError('');
    try {
      await payrollWrite(`/runs/${encodeURIComponent(data.run.id)}/status`, 'PATCH', { status, ...extra });
      setModal(''); setNotice(`Payroll marked ${status}.`); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payroll status could not be changed.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!selected) return; setSaving(true); setError('');
    try {
      await payrollWrite(`/profiles/${encodeURIComponent(selected.id)}`,'PUT',{ model: profile.model, monthlyRate: Number(profile.monthlyRate), hourlyRate: Number(profile.hourlyRate), classRate: Number(profile.classRate), teachingHourRate: Number(profile.teachingHourRate), allowance: Number(profile.allowance), effectiveFrom: profile.effectiveFrom, attendancePolicy: { deductUnpaidAbsences: profile.deductUnpaidAbsences }, reason: profile.reason });
      setNotice(`Compensation profile saved for ${selected.name}.`); setModal(''); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Compensation profile could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function saveIncrement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget);
    const field = String(form.get('rateField')); const increment = Number(form.get('value')); const mode = String(form.get('mode'));
    const current = Number((selected as any)[field] || 0); const newRate = mode === 'percent' ? current * (1 + increment / 100) : current + increment;
    setSaving(true); setError('');
    try {
      await payrollWrite('/increments','POST',{ staffId: selected.id, rateField: field, newRate: Number(newRate.toFixed(2)), effectiveFrom: String(form.get('effectiveFrom')), reason: String(form.get('reason')) });
      setNotice(`Increment recorded for ${selected.name}.`); setModal(''); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Increment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAdvance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError('');
    try {
      await payrollWrite('/advances','POST',{ staffId: String(form.get('staffId')), amount: String(form.get('amount')), repaymentAmount: String(form.get('repaymentAmount')), reason: String(form.get('reason')), requestedDate: String(form.get('requestedDate')) });
      setNotice('Advance request saved as pending approval.'); await openAdvances(); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Advance could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function updateAdvance(id: string, status: string) {
    setSaving(true); setError('');
    try {
      await payrollWrite(`/advances/${encodeURIComponent(id)}`,'PATCH',{ status, reason: status === 'approved' ? 'Approved by administrator' : 'Cancelled by administrator' });
      setAdvanceRecords(rows=>rows.map(row=>row.id===id?{...row,status}:row));
      setNotice(`Advance ${status}.`); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Advance status could not be changed.');
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError('');
    try {
      await payrollWrite('/work-records','POST',{ staffId: String(form.get('staffId')), classSessionId: String(form.get('classSessionId')||''), workDate: String(form.get('workDate')), recordKind: String(form.get('recordKind')), workStatus: String(form.get('workStatus')), minutes: Number(form.get('minutes')), payUnit: String(form.get('payUnit')), reason: String(form.get('reason')) });
      setNotice('Work record saved for review. It will not affect payroll until approved.'); setModal(''); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Work record could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function saveAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const form = new FormData(event.currentTarget); setSaving(true); setError('');
    try {
      await payrollWrite('/adjustments','POST',{ staffId: selected.id, period, kind: String(form.get('kind')), label: String(form.get('label')), amount: String(form.get('amount')), reason: String(form.get('reason')) });
      setNotice('Payroll adjustment saved for administrator review.'); setModal(''); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payroll adjustment could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function reviewAdjustment(id: string, status: string) {
    setSaving(true); setError('');
    try {
      await payrollWrite(`/adjustments/${encodeURIComponent(id)}`,'PATCH',{ status, reason: `${status} by administrator` });
      if (selected) await openDetail(selected);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Adjustment could not be reviewed.');
    } finally {
      setSaving(false);
    }
  }

  async function approveWork(id: string) {
    setSaving(true); setError('');
    try {
      await payrollWrite(`/work-records/${encodeURIComponent(id)}/approve`,'POST',{ reason: 'Reviewed by administrator' });
      if (selected) await openDetail(selected);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Work record could not be approved.');
    } finally {
      setSaving(false);
    }
  }

  async function saveZoomMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setSaving(true); setError('');
    try {
      await payrollWrite('/zoom/mappings','POST',{ staffId: String(form.get('staffId')), meetingId: String(form.get('meetingId')), classSessionId: String(form.get('classSessionId')), workDate: String(form.get('workDate')), durationMinutes: Number(form.get('durationMinutes')), payUnit: String(form.get('payUnit')) });
      setNotice('Zoom meeting mapping saved. Attendance remains pending until Zoom verifies the staff participant.'); setModal(''); await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Zoom mapping could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function syncZoom(mappingId: string) {
    setSaving(true); setError('');
    try {
      const result = await payrollWrite<{matched:number;pending?:boolean}>(`/zoom/mappings/${encodeURIComponent(mappingId)}/sync`,'POST',{});
      setNotice(result.matched ? 'Zoom attendance report matched the configured staff member.' : 'Zoom report is still pending or the staff email did not match.');
      if (selected) await openDetail(selected);
      await load(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Zoom attendance could not be synced.');
    } finally {
      setSaving(false);
    }
  }

  async function saveSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await transition('settled',{ paymentDate: String(form.get('paymentDate')), paymentReference: String(form.get('paymentReference')), paymentMethod: String(form.get('paymentMethod')), reason: String(form.get('reason')) });
  }

  const runStatus = data?.run?.status || 'not_generated';
  const steps = ['Draft / Generated','Approved','Finalized','Settled'];
  const doneAt = data?.run ? [true, ['approved','finalized','settled'].includes(runStatus), ['finalized','settled'].includes(runStatus), runStatus === 'settled'] : [false,false,false,false];
  const findStaff = (id: string) => data?.staff.find(staff=>staff.id===id);
  const openIncrement = () => { setSelected(data?.staff[0] || null); setModal('increment'); };

  // Run modal staff list filtering
  const previewOrAllStaff = preview?.records || (data?.staff || []).map(s => ({ ...s, eligible: s.profileSet && s.pendingWorkRecords === 0, warnings: [] }));
  const filteredRunStaff = useMemo(() => {
    return previewOrAllStaff.filter(s => {
      if (!runStaffSearch.trim()) return true;
      const text = `${s.name} ${s.employeeId} ${s.role} ${s.employmentType} ${modelLabel[s.model] || s.model}`.toLowerCase();
      return text.includes(runStaffSearch.toLowerCase());
    });
  }, [previewOrAllStaff, runStaffSearch]);

  const toggleStaffSelection = (id: string) => {
    setSelectedStaffIds(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]);
  };

  return (
    <div className="space-y-5 pb-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-orange-600">Staff Payroll</h2>
          <p className="mt-1 text-sm text-slate-500">Manage payroll for all staff members.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={openIncrement}>
            <AdminIcon name="trend" className="h-4 w-4 text-orange-600"/>Increment
          </button>
          <button className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={()=>void openAdvances()}>
            <AdminIcon name="payment" className="h-4 w-4 text-orange-600"/>Advances
          </button>
          <button
            className={`${button} bg-orange-500 text-white hover:bg-orange-600 shadow-md shadow-orange-200`}
            onClick={() => {
              setPreview(null);
              setSelectedStaffIds([]);
              setRunStaffSearch('');
              setRunError('');
              setModal('run');
            }}
          >
            <AdminIcon name="calculator" className="h-4 w-4"/>
            {data?.run?.status === 'draft' ? 'Recalculate Draft' : 'Run Payroll'}
          </button>
        </div>
      </header>

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <span>{notice}</span>
          <button aria-label="Dismiss" onClick={()=>setNotice('')} className="ml-3 text-lg font-bold">×</button>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-rose-700 shadow-sm">
          <span>{error}</span>
          <button className="font-bold underline ml-3" onClick={()=>void load(true)}>Retry</button>
        </div>
      )}

      {data?.schemaPending && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Payroll migration is pending. Apply migrations from the server directory before using this page.
        </div>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:gap-4 sm:px-5">
        <span className="mr-1 shrink-0 text-sm font-bold text-slate-600">View Period:</span>
        <select aria-label="Payroll month" className={`${fieldClass} w-full sm:!w-44`} value={month} onChange={event=>setMonth(Number(event.target.value))}>
          {monthNames.map((name,index)=><option key={name} value={index+1}>{name}</option>)}
        </select>
        <select aria-label="Payroll year" className={`${fieldClass} w-full sm:!w-28`} value={year} onChange={event=>setYear(Number(event.target.value))}>
          {Array.from({length:7},(_,i)=>now.getFullYear()-3+i).map(value=><option key={value}>{value}</option>)}
        </select>
        {runStatus==='finalized' ? (
          <button className={`${button} bg-emerald-600 text-white`} onClick={()=>setModal('settle')}>Settle</button>
        ) : (
          <button className={`${button} border border-orange-200 bg-white text-orange-600 hover:bg-orange-50`} onClick={()=>void load(true)}>Refresh</button>
        )}
        <span className={`rounded-full px-3 py-1.5 text-xs font-black uppercase sm:ml-1 ${runStatus==='settled'?'bg-emerald-100 text-emerald-700':runStatus==='finalized'?'bg-violet-100 text-violet-700':runStatus==='approved'?'bg-orange-100 text-orange-700':'bg-slate-100 text-slate-600'}`}>
          {runStatus.replace('_',' ')}
        </span>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="TOTAL STAFF" icon="person" value={loading&&!data?'—':data?.stats.totalStaff||0} tone="green"/>
        <Stat label="PROFILES SET UP" icon="verified" value={loading&&!data?'—':data?.stats.profilesSetUp||0} hint="compensation configured"/>
        <Stat label="WORKING DAYS" icon="calendar" value={loading&&!data?'—':data?.stats.workingDays||0} hint={`${monthNames[month-1]} ${year}`}/>
        <Stat label="TOTAL SETTLED THIS PERIOD" icon="payment" value={inr(data?.stats.settledAmount||0)} tone="teal" hint={runStatus==='settled'?'manually recorded settlement':'not settled'}/>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-black text-slate-800">{monthNames[month-1]} {year} Payroll</h3>
            <p className="text-xs text-slate-500">{data?.run?`${data.run.staffCount} staff · Gross ${inr(data.run.grossTotal)} · Net ${inr(data.run.netTotal)}`:'No payroll snapshot generated for this period'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.run && (
              <>
                <button className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={()=>void openRunHistory(data.run!.id)}>Review</button>
                <button className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`} onClick={()=>void payrollDownload(`/export.csv?month=${month}&year=${year}`,`payroll-${period}.csv`).catch(e=>setError(String(e)))}>
                  <AdminIcon name="download" className="h-4 w-4"/>CSV
                </button>
                {runStatus==='draft' && <button className={`${button} bg-orange-500 text-white hover:bg-orange-600`} disabled={saving||Boolean(data?.run?.reviewRequired)} onClick={()=>void transition('approved')}>Approve</button>}
                {runStatus==='approved' && <button className={`${button} bg-violet-600 text-white`} disabled={saving} onClick={()=>void transition('finalized')}>Finalize</button>}
                {runStatus==='finalized' && <button className={`${button} bg-emerald-600 text-white`} disabled={saving} onClick={()=>setModal('settle')}>Settle</button>}
              </>
            )}
          </div>
        </div>
        {data?.run?.reviewRequired && (
          <p role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
            Payroll inputs changed after this draft was generated. Recalculate it before approval. {data.run.reviewReason}
          </p>
        )}
        <div className="mt-5 grid grid-cols-4 gap-2">
          {steps.map((step,index)=>(
            <div key={step} className="min-w-0">
              <div className={`h-1.5 rounded-full ${doneAt[index]?'bg-emerald-500':index===0&&data?.run?'bg-orange-500':'bg-slate-200'}`}/>
              <p className={`mt-2 truncate text-[10px] font-bold sm:text-xs ${doneAt[index]?'text-emerald-700':'text-slate-400'}`}>{step}</p>
              {doneAt[index] && data?.run && (
                <p className="truncate text-[10px] text-slate-400">
                  {[null,data.run.approvedAt,data.run.finalizedAt,data.run.settledAt][index] ? new Date([null,data.run.approvedAt,data.run.finalizedAt,data.run.settledAt][index] as string).toLocaleDateString() : 'Recorded'}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-orange-100 bg-gradient-to-r from-orange-50 to-white px-4 py-3">
          <div>
            <h3 className="font-black text-slate-800">Staff — {monthNames[month-1]} {year}</h3>
            <p className="text-xs text-slate-500">Salary configuration, attendance and approved teaching time</p>
          </div>
          <div className="flex gap-2">
            <button className={`${button} border border-orange-200 bg-white text-orange-600 hover:bg-orange-50`} onClick={()=>{setSelected(null);setModal('work')}}>Add Work Record</button>
            <button className={`${button} border border-orange-200 bg-white text-orange-600 hover:bg-orange-50`} onClick={()=>setModal('zoom')}>
              <AdminIcon name="video" className="h-4 w-4"/>Zoom
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-100 p-3">
          <input
            aria-label="Search staff payroll"
            className={`${fieldClass} min-w-48 flex-1`}
            placeholder="Search staff name or employee ID…"
            value={query}
            onChange={event=>setQuery(event.target.value)}
          />
          <select aria-label="Filter compensation model" className={`${fieldClass} w-48`} value={typeFilter} onChange={event=>setTypeFilter(event.target.value)}>
            <option value="all">All employment models</option>
            {Object.entries(modelLabel).map(([key,label])=><option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="Filter payroll attention" className={`${fieldClass} w-44`} value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="missing">Profile missing</option>
            <option value="pending">Work needs review</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-orange-50/70 text-[10px] font-black uppercase tracking-wide text-orange-700">
              <tr>
                {['Teacher / Staff','Employment','Salary Rate','Present / Days','Attendance','Approved Work','Gross Pay','Deductions','Net Pay','Status','Actions'].map(item=><th key={item} className="px-3 py-3">{item}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data && (
                <tr><td colSpan={11} className="px-4 py-12 text-center text-slate-400">Loading payroll records…</td></tr>
              )}
              {filteredStaff.map(staff => (
                <tr key={staff.id} className="hover:bg-orange-50/30 transition">
                  <td className="px-3 py-3">
                    <div className="flex flex-col">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <b className="text-slate-800">{staff.name || 'Unnamed staff'}</b>
                        {!staff.hasPaymentDetails && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 cursor-pointer hover:bg-amber-100 transition"
                            onClick={() => openPaymentDetails(staff)}
                            title="Click to add Bank Account or UPI details"
                          >
                            Payment details missing
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-500">{staff.employeeId || staff.email || '—'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">
                      {modelLabel[staff.model] || staff.employmentType || '—'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs font-medium">
                    {staff.model==='monthly'||staff.model==='hybrid'?inr(staff.monthlyRate):staff.model==='per_class'?`${inr(staff.classRate)} / class`:`${inr(staff.hourlyRate||staff.teachingHourRate)} / hr`}
                  </td>
                  <td className="px-3 py-3 tabular-nums font-semibold">{staff.presentDays} / {data?.stats.workingDays||0}</td>
                  <td className="px-3 py-3 font-semibold">{staff.attendancePercent===null?'—':`${staff.attendancePercent}%`}</td>
                  <td className="px-3 py-3 text-xs">
                    {staff.pendingWorkRecords ? (
                      <button onClick={()=>void openDetail(staff)} className="font-bold text-amber-700 underline">
                        {staff.pendingWorkRecords} pending
                      </button>
                    ) : (
                      `${staff.payableHours.toFixed(2)} hr · ${staff.approvedClasses} classes`
                    )}
                  </td>
                  <td className="px-3 py-3 font-bold text-slate-900">{inr(staff.grossPay)}</td>
                  <td className="px-3 py-3 font-semibold text-rose-700">{inr(staff.totalDeductions)}</td>
                  <td className="px-3 py-3 font-black text-emerald-700">{inr(staff.netPay)}</td>
                  <td className="px-3 py-3">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-black ${
                      staff.isPaid || staff.payrollStatus === 'settled' || data?.run?.status === 'settled' ? 'bg-emerald-100 text-emerald-700' :
                      !staff.profileSet ? 'bg-amber-100 text-amber-800' :
                      staff.pendingWorkRecords ? 'bg-orange-100 text-orange-800' :
                      staff.isGenerated || data?.run ? 'bg-blue-100 text-slate-800' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {staff.isPaid || staff.payrollStatus === 'settled' ? 'Paid' :
                       !staff.profileSet ? 'Profile needed' :
                       staff.pendingWorkRecords ? 'Review needed' :
                       staff.isGenerated ? (staff.payrollStatus === 'draft' ? 'Generated' : staff.payrollStatus) :
                       data?.run?.status ? (data.run.status === 'draft' ? 'Generated' : data.run.status) :
                       'Not generated'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <button
                        title="View Calculation Breakdown"
                        onClick={() => openCalculation(staff)}
                        className="inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-1.5 text-xs font-bold text-orange-700 hover:bg-orange-100 transition"
                      >
                        <AdminIcon name="calculator" className="h-3.5 w-3.5" />
                        Breakdown
                      </button>

                      {staff.isPaid || staff.payrollStatus === 'settled' ? (
                        <button
                          title="View / Print Salary Payment Receipt"
                          onClick={() => openReceipt(staff)}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-black text-emerald-800 hover:bg-emerald-100 transition shadow-sm"
                        >
                          <AdminIcon name="document" className="h-3.5 w-3.5 text-emerald-700" />
                          Receipt
                        </button>
                      ) : (
                        <button
                          title={staff.isGenerated ? "Disburse Salary Payment via Bank Transfer or UPI" : "Generate payroll first to enable payout"}
                          disabled={!staff.isGenerated}
                          onClick={() => openPay(staff)}
                          className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-black transition shadow-sm ${
                            staff.isGenerated
                              ? 'border border-orange-500 bg-orange-500 text-white hover:bg-orange-600'
                              : 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                          }`}
                        >
                          <AdminIcon name="payment" className="h-3.5 w-3.5" />
                          Pay
                        </button>
                      )}

                      <button
                        title={staff.hasPaymentDetails ? "View / Edit Bank Details" : "Add Payment Details"}
                        onClick={() => openPaymentDetails(staff)}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-bold transition ${staff.hasPaymentDetails ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                      >
                        <AdminIcon name="key" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Edit compensation profile"
                        onClick={() => openProfile(staff)}
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 transition"
                      >
                        <AdminIcon name="pencil" className="h-3.5 w-3.5" />
                      </button>
                      <button
                        title="Add earning or deduction"
                        onClick={() => { setSelected(staff); setModal('adjustment'); }}
                        className="rounded-lg border border-slate-200 p-1.5 text-amber-700 hover:bg-amber-50 transition"
                      >
                        <AdminIcon name="trend" className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredStaff.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-14 text-center">
                    <p className="font-bold text-slate-700">{data?.staff.length ? 'No staff match these filters.' : 'No staff members are available for payroll.'}</p>
                    <p className="mt-1 text-sm text-slate-500">Staff records appear here from your existing staff directory.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {data?.run && (
          <div className="flex flex-wrap justify-between gap-2 border-t bg-slate-50 px-4 py-3 text-sm">
            <span><b>{data.run.staffCount}</b> staff in saved payroll</span>
            <span>Gross <b>{inr(data.run.grossTotal)}</b> · Deductions <b className="text-rose-700">{inr(data.run.deductionTotal)}</b> · Net <b className="text-emerald-700">{inr(data.run.netTotal)}</b></span>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-orange-100 bg-orange-50/60 px-4 py-3">
          <h3 className="font-black text-slate-800">Payroll History</h3>
          <button className="text-xs font-bold text-orange-600 underline" onClick={()=>void payrollDownload('/history.csv','payroll-history.csv').catch(cause=>setError(String(cause)))}>
            Export history
          </button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-sm">
            <thead className="text-[10px] font-black uppercase text-slate-500">
              <tr>{['Period','Staff','Gross','Deductions','Net Pay','Status','Actions'].map(x=><th className="px-4 py-3" key={x}>{x}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {data?.history.map(item=>(
                <tr key={item.id} className="hover:bg-slate-50/60 transition">
                  <td className="px-4 py-3 font-bold">{new Date(`${item.periodStart}T00:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'})}</td>
                  <td className="px-4 py-3">{item.staffCount}</td>
                  <td className="px-4 py-3">{inr(item.grossTotal)}</td>
                  <td className="px-4 py-3 text-rose-700">{inr(item.deductionTotal)}</td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{inr(item.netTotal)}</td>
                  <td className="px-4 py-3"><span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-bold text-orange-600">{item.status}</span></td>
                  <td className="px-4 py-3">
                    <button className="font-bold text-orange-600 underline" onClick={()=>void openRunHistory(item.id)}>View</button> · <button className="font-bold text-orange-600 underline" onClick={()=>void payrollDownload(`/export.csv?runId=${encodeURIComponent(item.id)}`,`payroll-${item.periodStart}.csv`).catch(cause=>setError(String(cause)))}>CSV</button>
                  </td>
                </tr>
              ))}
              {!data?.history.length && (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">Payroll snapshots will appear here after you generate a draft.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Upgraded Task 1: Run Payroll Modal with Searchable Multi-Select */}
      {modal === 'run' && (
        <ModalFrame title="Run Payroll" icon="calculator" onClose={() => setModal('')} wide>
          <form className="space-y-5" onSubmit={event => { event.preventDefault(); void generatePayroll(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Month *">
                <select className={fieldClass} value={month} onChange={event => { setPreview(null); setMonth(Number(event.target.value)); }}>
                  {monthNames.map((name,index) => <option key={name} value={index+1}>{name}</option>)}
                </select>
              </Field>
              <Field label="Year *">
                <select className={fieldClass} value={year} onChange={event => { setPreview(null); setYear(Number(event.target.value)); }}>
                  {Array.from({length:7},(_,i) => now.getFullYear()-3+i).map(value => <option key={value}>{value}</option>)}
                </select>
              </Field>
            </div>

            {runError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex justify-between items-center">
                <span>{runError}</span>
                <button type="button" className="font-bold underline text-xs ml-3" onClick={() => void previewPayroll()}>Retry</button>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Select Staff (Optional)</span>
                  <span className="ml-2 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-800">
                    {selectedStaffIds.length === 0 ? 'All Eligible Staff' : `${selectedStaffIds.length} staff selected`}
                  </span>
                </div>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds([])}
                    className={`rounded-lg border px-2.5 py-1 font-bold transition ${selectedStaffIds.length === 0 ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    All Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds(filteredRunStaff.filter(s => s.eligible).map(s => s.id))}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 font-bold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Select All Eligible
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedStaffIds([])}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 font-bold text-slate-600 hover:bg-slate-50 transition"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search staff by name, role, employee code (e.g. EMP-001)..."
                  value={runStaffSearch}
                  onChange={e => setRunStaffSearch(e.target.value)}
                  className={fieldClass}
                />
                {runStaffSearch && (
                  <button
                    type="button"
                    onClick={() => setRunStaffSearch('')}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 font-bold"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Selected Staff Chips */}
              {selectedStaffIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-orange-50/50 border border-orange-100 max-h-24 overflow-y-auto">
                  {selectedStaffIds.map(id => {
                    const st = previewOrAllStaff.find(s => s.id === id);
                    if (!st) return null;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-white border border-orange-200 px-2.5 py-1 text-xs font-bold text-orange-950 shadow-sm">
                        <span>{st.name}</span>
                        <button
                          type="button"
                          onClick={() => toggleStaffSelection(id)}
                          className="text-slate-400 hover:text-rose-600 font-black text-sm ml-0.5"
                          title="Remove"
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Staff List */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
                {saving && !preview && (
                  <p role="status" className="p-6 text-center text-sm text-slate-500">Loading eligible staff…</p>
                )}
                {!saving && filteredRunStaff.length === 0 && (
                  <p className="p-6 text-center text-sm text-slate-400">No staff members found matching "{runStaffSearch}".</p>
                )}
                {filteredRunStaff.map(st => {
                  const isChecked = selectedStaffIds.includes(st.id);
                  return (
                    <div
                      key={st.id}
                      onClick={() => toggleStaffSelection(st.id)}
                      className={`flex items-center justify-between p-3 cursor-pointer transition ${isChecked ? 'bg-orange-50/60' : 'hover:bg-slate-50'}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleStaffSelection(st.id)}
                          className="h-4 w-4 rounded text-orange-600 focus:ring-orange-500 accent-orange-600"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 text-sm">{st.name}</span>
                            {st.employeeId && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                                {st.employeeId}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 truncate">
                            {st.role || 'Teacher'} • {modelLabel[st.model] || st.employmentType || st.model}
                            {st.monthlyRate ? ` • ${inr(st.monthlyRate)}/mo` : st.hourlyRate ? ` • ${inr(st.hourlyRate)}/hr` : st.classRate ? ` • ${inr(st.classRate)}/class` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 shrink-0 ml-2">
                        {!st.profileSet && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                            Profile missing
                          </span>
                        )}
                        {Boolean(st.pendingWorkRecords) && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-800">
                            {st.pendingWorkRecords} pending
                          </span>
                        )}
                        {!st.hasPaymentDetails && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800 border border-amber-200">
                            Payment details missing
                          </span>
                        )}
                        {st.eligible && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            Ready
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl bg-orange-50/70 border border-orange-100 p-4 text-xs leading-5 text-orange-900">
              Payroll uses approved attendance and teaching records, configured compensation rates, applicable deductions and approved advance recoveries. Unverified work is skipped and listed for review.
            </div>

            <footer className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className={`${button} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
                onClick={() => setModal('')}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`${button} bg-orange-500 text-white hover:bg-orange-600 shadow-md shadow-orange-200`}
                disabled={saving || (Boolean(preview) && !preview?.records.some(r => r.eligible))}
              >
                {saving ? 'Generating…' : selectedStaffIds.length > 0 ? `Generate for ${selectedStaffIds.length} Staff` : 'Generate for All Staff'}
              </button>
            </footer>
          </form>
        </ModalFrame>
      )}

      {/* Generation Result Modal */}
      {modal === 'generation-result' && generationResult && (
        <ModalFrame title="Payroll Generated" icon="verified" onClose={() => setModal('')} wide>
          <div className="space-y-5">
            <p className="text-sm text-slate-600">
              {monthNames[Number(generationResult.run.period.slice(5,7))-1]} {generationResult.run.period.slice(0,4)} payroll snapshot was successfully updated as a draft.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Stat label="PROCESSED" value={generationResult.run.staffCount} icon="person"/>
              <Stat label="GENERATED" value={generationResult.generated} icon="verified" tone="green"/>
              <Stat label="GROSS PAY" value={inr(generationResult.run.grossTotal)} icon="payment" tone="green"/>
              <Stat label="NET PAY" value={inr(generationResult.run.netTotal)} icon="trend" tone="teal"/>
            </div>
            <p className="text-sm">
              Deductions: <b>{inr(generationResult.run.deductionTotal)}</b> · Status: <b className="uppercase">{generationResult.run.status}</b> · Skipped: <b>{generationResult.skipped.length}</b>
            </p>
            {generationResult.skipped.length > 0 && (
              <section className="max-h-40 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3">
                <h3 className="mb-2 text-sm font-black text-amber-900">Skipped staff and reasons</h3>
                {generationResult.skipped.map(row => (
                  <p key={row.staffId} className="text-sm text-amber-900">{row.name || row.staffId}: {row.reason}</p>
                ))}
              </section>
            )}
            <footer className="flex flex-wrap justify-end gap-2 pt-2">
              <button className={`${button} border border-orange-200 text-orange-600 hover:bg-orange-50`} onClick={() => void openRunHistory(generationResult.run.id)}>
                View Saved Payroll Run
              </button>
              <button
                className={`${button} bg-orange-500 text-white hover:bg-orange-600`}
                onClick={() => void payrollDownload(`/export.csv?runId=${encodeURIComponent(generationResult.run.id)}`,`payroll-${generationResult.run.period}.csv`).catch(cause => setError(cause instanceof Error ? cause.message : 'Payroll report download failed.'))}
              >
                Download Payroll Report
              </button>
            </footer>
          </div>
        </ModalFrame>
      )}

      {/* Task 3: Dedicated "View Calculation" Modal */}
      {modal === 'view-calculation' && selected && (
        <ModalFrame title={`Payroll Calculation Breakdown — ${selected.name}`} icon="calculator" onClose={() => setModal('')} wide>
          <div className="space-y-5">
            {/* Top Bar with Period and Status */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gradient-to-r from-orange-50 to-amber-50 p-4 border border-orange-100">
              <div>
                <span className="text-xs font-black uppercase tracking-wider text-orange-700">Calculation Period</span>
                <h3 className="text-xl font-black text-slate-900">{monthNames[month-1]} {year}</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">Status:</span>
                <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                  runStatus === 'settled' ? 'bg-emerald-100 text-emerald-800' :
                  runStatus === 'finalized' ? 'bg-violet-100 text-violet-800' :
                  data?.run ? 'bg-blue-100 text-slate-800' : 'bg-slate-100 text-slate-600'
                }`}>
                  {data?.run ? (data.run.status === 'draft' ? 'Generated (Draft)' : data.run.status) : 'Not Generated'}
                </span>
              </div>
            </div>

            {/* Staff Info & Compensation Setup */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Staff Profile</h4>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Full Name</span><b className="text-slate-800">{selected.name}</b></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Employee ID</span><span className="font-semibold">{selected.employeeId || '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Role / Designation</span><span className="font-semibold">{selected.role || 'Teacher'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-500">Employment Model</span><span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">{modelLabel[selected.model] || selected.employmentType}</span></div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Configured Rate</span>
                  <b className="text-slate-900">
                    {selected.model === 'monthly' ? `${inr(selected.monthlyRate)} / month` :
                     selected.model === 'per_class' ? `${inr(selected.classRate)} / class` :
                     `${inr(selected.hourlyRate || selected.teachingHourRate)} / hour`}
                  </b>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-400">Payment Payout Destination</h4>
                  <button onClick={() => openPaymentDetails(selected)} className="text-xs font-bold text-orange-600 hover:underline">Edit</button>
                </div>
                {selected.hasPaymentDetails ? (
                  <div className="space-y-1.5 text-sm">
                    {selected.paymentDetails?.bankAccountNumber ? (
                      <div>
                        <span className="text-slate-500">Bank Account:</span>{' '}
                        <b className="text-slate-800">
                          {selected.paymentDetails.bankName || 'Bank'} · ••••{selected.paymentDetails.bankAccountNumber.slice(-4)}
                        </b>
                        <p className="text-xs text-slate-400">A/C Holder: {selected.paymentDetails.accountHolderName || selected.name} · IFSC: {selected.paymentDetails.ifscCode}</p>
                      </div>
                    ) : null}
                    {selected.paymentDetails?.upiId ? (
                      <div>
                        <span className="text-slate-500">UPI ID / VPA:</span> <b className="text-slate-800">{selected.paymentDetails.upiId}</b>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-bold text-amber-900">⚠️ No payment details configured for this staff member.</p>
                    <button
                      onClick={() => openPaymentDetails(selected)}
                      className="mt-2 text-xs font-bold text-orange-600 underline"
                    >
                      Add Bank Account or UPI now →
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Attendance & Teaching Summary */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Attendance & Approved Teaching Summary</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-[10px] font-extrabold uppercase text-slate-400">Working Days</span>
                  <p className="mt-1 text-xl font-black text-slate-800">{data?.stats.workingDays || 0}</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800">
                  <span className="text-[10px] font-extrabold uppercase">Present Days</span>
                  <p className="mt-1 text-xl font-black">{selected.presentDays}</p>
                </div>
                <div className="rounded-xl bg-rose-50 p-3 text-rose-800">
                  <span className="text-[10px] font-extrabold uppercase">Absent Days</span>
                  <p className="mt-1 text-xl font-black">{selected.absentDays}</p>
                </div>
                <div className="rounded-xl bg-orange-50 p-3 text-orange-800">
                  <span className="text-[10px] font-extrabold uppercase">Attendance %</span>
                  <p className="mt-1 text-xl font-black">{selected.attendancePercent === null ? '—' : `${selected.attendancePercent}%`}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-between items-center bg-slate-50 rounded-xl p-3 text-xs text-slate-600">
                <span><b>Approved Teaching:</b> {selected.approvedClasses} classes · {selected.payableHours.toFixed(2)} hours ({selected.approvedMinutes} mins)</span>
                <span><b>Leave Days:</b> {selected.paidLeaveDays || 0} paid · {selected.unpaidLeaveDays || 0} unpaid</span>
              </div>
            </div>

            {/* Step-by-Step Calculation Formula Cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Earnings */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-emerald-700">Gross Earnings Breakdown</h4>
                <div className="space-y-2 text-sm">
                  {selected.model === 'monthly' && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Base Salary (Prorated)</span>
                      <span className="font-bold">{inr(selected.baseEarnings)}</span>
                    </div>
                  )}
                  {selected.model === 'hourly' && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Hourly Pay ({selected.payableHours.toFixed(2)} hr × {inr(selected.hourlyRate || selected.teachingHourRate)})</span>
                      <span className="font-bold">{inr(selected.teachingEarnings)}</span>
                    </div>
                  )}
                  {selected.model === 'per_class' && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Class Pay ({selected.approvedClasses} classes × {inr(selected.classRate)})</span>
                      <span className="font-bold">{inr(selected.teachingEarnings)}</span>
                    </div>
                  )}
                  {selected.model === 'hybrid' && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Base Salary</span>
                        <span className="font-bold">{inr(selected.baseEarnings)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-600">Classes Pay ({selected.approvedClasses} × {inr(selected.classRate)})</span>
                        <span className="font-bold">{inr(selected.teachingEarnings)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-slate-600">
                    <span>Allowances</span>
                    <span className="font-semibold">{inr(selected.allowance)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Other Earnings / Adjustments</span>
                    <span className="font-semibold">{inr(selected.otherEarnings)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-black text-slate-900 text-base">
                    <span>Gross Pay</span>
                    <span className="text-emerald-700">{inr(selected.grossPay)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-rose-700">Deductions & Advances Breakdown</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between text-slate-600">
                    <span>PF Deduction</span>
                    <span className="font-semibold text-rose-700">{inr(selected.pfDeduction || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>TDS Deduction</span>
                    <span className="font-semibold text-rose-700">{inr(selected.tdsDeduction || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Salary Advance Recovery</span>
                    <span className="font-semibold text-rose-700">{inr(selected.advanceRecovery || 0)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Other Deductions</span>
                    <span className="font-semibold text-rose-700">{inr(selected.otherDeductions || 0)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-black text-slate-900 text-base">
                    <span>Total Deductions</span>
                    <span className="text-rose-700">{inr(selected.totalDeductions)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Payable Banner */}
            <div className="rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 p-5 text-white flex flex-wrap items-center justify-between gap-3 shadow-md">
              <div>
                <span className="text-xs font-black uppercase tracking-widest text-emerald-100">Final Net Payable</span>
                <p className="text-3xl font-black mt-1">{inr(selected.netPay)}</p>
                <p className="text-xs text-emerald-100 mt-1">Gross ({inr(selected.grossPay)}) − Deductions ({inr(selected.totalDeductions)})</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => openProfile(selected)}
                  className="rounded-xl bg-white/20 hover:bg-white/30 text-white font-bold px-4 py-2.5 text-xs transition"
                >
                  Edit Profile
                </button>
              </div>
            </div>

            {/* Skipped / Unverified Work Alert */}
            {selected.pendingWorkRecords > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
                <div className="flex items-start gap-3">
                  <AdminIcon name="clock" className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                  <div>
                    <h5 className="font-black text-sm">Skipped from payout — needs administrator review</h5>
                    <p className="mt-1 text-xs">
                      {selected.pendingWorkRecords} attendance or teaching records have not yet been approved. These are excluded from this calculation. Verify them in the "Work & Attendance Review" section to include them.
                    </p>
                    <button
                      onClick={() => void openDetail(selected)}
                      className="mt-2 text-xs font-bold text-amber-800 underline"
                    >
                      Open Work Review →
                    </button>
                  </div>
                </div>
              </div>
            )}

            <footer className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                className={`${button} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
                onClick={() => setModal('')}
              >
                Close
              </button>
            </footer>
          </div>
        </ModalFrame>
      )}

      {/* Task 2: Inline Payment Details Modal */}
      {modal === 'payment-details' && selected && (
        <ModalFrame title={`Payment Details — ${selected.name}`} icon="payment" onClose={() => setModal('')}>
          <form className="space-y-4" onSubmit={savePaymentDetails}>
            <p className="text-sm text-slate-600">
              Configure bank account or UPI details for <b>{selected.name}</b> ({selected.employeeId || 'Staff'}). Payout details are strictly confidential.
            </p>

            <div>
              <span className="block text-xs font-extrabold uppercase tracking-wide text-slate-600 mb-2">Payment Mode Preference</span>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'bank', label: 'Bank Transfer' },
                  { id: 'upi', label: 'UPI' },
                  { id: 'both', label: 'Both / Flexible' }
                ].map(m => (
                  <label key={m.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition ${paymentForm.paymentMode === m.id ? 'border-orange-500 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-700'}`}>
                    <input
                      type="radio"
                      name="paymentMode"
                      checked={paymentForm.paymentMode === m.id}
                      onChange={() => setPaymentForm(p => ({ ...p, paymentMode: m.id }))}
                      className="accent-orange-600"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-orange-700">Bank Account Details</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Account Holder Name">
                  <input
                    className={fieldClass}
                    value={paymentForm.accountHolderName}
                    onChange={e => setPaymentForm(p => ({ ...p, accountHolderName: e.target.value }))}
                    placeholder={selected.name}
                  />
                </Field>
                <Field label="Bank Name">
                  <input
                    className={fieldClass}
                    value={paymentForm.bankName}
                    onChange={e => setPaymentForm(p => ({ ...p, bankName: e.target.value }))}
                    placeholder="e.g. HDFC Bank, SBI"
                  />
                </Field>
                <Field label="Account Number">
                  <input
                    className={fieldClass}
                    value={paymentForm.bankAccountNumber}
                    onChange={e => setPaymentForm(p => ({ ...p, bankAccountNumber: e.target.value }))}
                    placeholder="6 to 34 digits"
                  />
                </Field>
                <Field label="IFSC Code">
                  <input
                    className={fieldClass}
                    value={paymentForm.ifscCode}
                    onChange={e => setPaymentForm(p => ({ ...p, ifscCode: e.target.value.toUpperCase() }))}
                    placeholder="ABCD0123456"
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Branch (Optional)">
                    <input
                      className={fieldClass}
                      value={paymentForm.branch}
                      onChange={e => setPaymentForm(p => ({ ...p, branch: e.target.value }))}
                      placeholder="Branch name or location"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wide text-orange-700">UPI Details</h4>
              <Field label="UPI ID / VPA">
                <input
                  className={fieldClass}
                  value={paymentForm.upiId}
                  onChange={e => setPaymentForm(p => ({ ...p, upiId: e.target.value.toLowerCase().trim() }))}
                  placeholder="e.g. name@okhdfcbank or 9876543210@paytm"
                />
              </Field>
            </div>

            <p className="text-xs text-slate-500">
              At least one payment method (Bank Account OR UPI ID) is required for processing payouts.
            </p>

            <footer className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className={`${button} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
                onClick={() => setModal('')}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className={`${button} bg-orange-500 text-white hover:bg-orange-600`}
              >
                {saving ? 'Saving…' : 'Save Payment Details'}
              </button>
            </footer>
          </form>
        </ModalFrame>
      )}

            {/* Pay Salary Modal (Task 4) */}
      {modal === 'pay' && selected && (
        <ModalFrame title={`Pay Salary — ${selected.name}`} icon="payment" onClose={() => setModal('')} wide>
          <form className="space-y-5" onSubmit={submitPayment}>
            {/* Top Staff & Period Summary */}
            <div className="rounded-2xl border border-orange-200 bg-gradient-to-r from-orange-50 to-orange-100/50 p-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900">{selected.name}</h3>
                  <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[10px] font-black uppercase text-orange-800">
                    {selected.employeeId || 'EMP'}
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {selected.role} • {modelLabel[selected.model] || selected.employmentType}
                </p>
                <p className="text-xs font-extrabold text-orange-700 mt-1">
                  Salary Period: {monthNames[(data?.period.month ?? 10) - 1]} {data?.period.year ?? 2026}
                </p>
              </div>

              <div className="text-right">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500">Net Payable Amount</span>
                <div className="text-2xl sm:text-3xl font-black text-emerald-700 tracking-tight">
                  {inr(selected.netPay)}
                </div>
                <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-slate-500">
                  <span>Gross: <b>{inr(selected.grossPay)}</b></span>
                  <span>•</span>
                  <span>Deductions: <b className="text-rose-600">{inr(selected.totalDeductions)}</b></span>
                </div>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div>
              <span className="block text-xs font-black uppercase tracking-wide text-slate-700 mb-2">
                Select Payment Method
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPayMethod('Bank Transfer')}
                  className={`flex items-center justify-center gap-2 rounded-2xl border-2 p-3 text-sm font-black transition ${
                    payMethod === 'Bank Transfer'
                      ? 'border-orange-500 bg-orange-50 text-orange-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <AdminIcon name="building" className="h-5 w-5 text-orange-600" />
                  Bank Transfer (NEFT / IMPS)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPayMethod('UPI');
                    if (upiInput) {
                      const periodLabel = `${monthNames[(data?.period.month ?? 10) - 1]} ${data?.period.year ?? 2026}`;
                      void generateQr(upiInput, selected.name, selected.netPay, periodLabel);
                    }
                  }}
                  className={`flex items-center justify-center gap-2 rounded-2xl border-2 p-3 text-sm font-black transition ${
                    payMethod === 'UPI'
                      ? 'border-orange-500 bg-orange-50 text-orange-900 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <AdminIcon name="qrcode" className="h-5 w-5 text-orange-600" />
                  UPI (QR Code / VPA)
                </button>
              </div>
            </div>

            {/* Bank Transfer View */}
            {payMethod === 'Bank Transfer' && (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-orange-800">
                    Beneficiary Bank Details
                  </h4>
                  {selected.paymentDetails?.bankAccountNumber && (
                    <button
                      type="button"
                      onClick={() => setEditBankInline(!editBankInline)}
                      className="text-xs font-bold text-orange-600 hover:underline"
                    >
                      {editBankInline ? 'Use Saved Details' : 'Edit / Update Details'}
                    </button>
                  )}
                </div>

                {!editBankInline && selected.paymentDetails?.bankAccountNumber ? (
                  <div className="grid gap-2 sm:grid-cols-2 text-xs bg-white rounded-xl p-3.5 border border-slate-200">
                    <div>
                      <span className="text-slate-400 block font-semibold">Account Holder</span>
                      <strong className="text-slate-900 text-sm">{selected.paymentDetails.accountHolderName || selected.name}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold">Bank Name</span>
                      <strong className="text-slate-800 text-sm">{selected.paymentDetails.bankName || 'Bank'}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold">Account Number</span>
                      <strong className="font-mono text-slate-900 text-sm">
                        •••• •••• {selected.paymentDetails.bankAccountNumber.slice(-4)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block font-semibold">IFSC Code</span>
                      <strong className="font-mono text-orange-700 text-sm">{selected.paymentDetails.ifscCode || '—'}</strong>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Account Holder Name">
                      <input
                        className={fieldClass}
                        value={bankForm.accountHolderName}
                        onChange={e => setBankForm(b => ({ ...b, accountHolderName: e.target.value }))}
                        placeholder={selected.name}
                      />
                    </Field>
                    <Field label="Bank Name">
                      <input
                        className={fieldClass}
                        value={bankForm.bankName}
                        onChange={e => setBankForm(b => ({ ...b, bankName: e.target.value }))}
                        placeholder="e.g. HDFC Bank, SBI"
                      />
                    </Field>
                    <Field label="Account Number*">
                      <input
                        className={fieldClass}
                        value={bankForm.bankAccountNumber}
                        onChange={e => setBankForm(b => ({ ...b, bankAccountNumber: e.target.value }))}
                        placeholder="Enter full account number"
                      />
                    </Field>
                    <Field label="IFSC Code">
                      <input
                        className={fieldClass}
                        value={bankForm.ifscCode}
                        onChange={e => setBankForm(b => ({ ...b, ifscCode: e.target.value.toUpperCase() }))}
                        placeholder="e.g. HDFC0001234"
                      />
                    </Field>
                    <Field label="Branch Name">
                      <input
                        className={fieldClass}
                        value={bankForm.branch}
                        onChange={e => setBankForm(b => ({ ...b, branch: e.target.value }))}
                        placeholder="e.g. Connaught Place"
                      />
                    </Field>
                  </div>
                )}
              </div>
            )}

            {/* UPI View */}
            {payMethod === 'UPI' && (
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <h4 className="text-xs font-black uppercase tracking-wider text-orange-800">
                  UPI Payout (Instant QR)
                </h4>

                <div className="grid gap-4 sm:grid-cols-[1fr_240px] items-start">
                  <div className="space-y-3">
                    <Field label="Staff UPI ID / VPA*">
                      <input
                        className={fieldClass}
                        value={upiInput}
                        onChange={e => {
                          const v = e.target.value.toLowerCase().trim();
                          setUpiInput(v);
                          const periodLabel = `${monthNames[(data?.period.month ?? 10) - 1]} ${data?.period.year ?? 2026}`;
                          void generateQr(v, selected.name, selected.netPay, periodLabel);
                        }}
                        placeholder="e.g. name@okhdfcbank or 9876543210@paytm"
                      />
                    </Field>
                    <p className="text-xs text-slate-500">
                      Scan the QR code directly from any UPI app (Google Pay, PhonePe, Paytm, BHIM) to transfer exact salary.
                    </p>
                    <div className="rounded-xl bg-orange-100/60 p-3 text-xs text-orange-900 border border-orange-200">
                      <b>Amount locked:</b> {inr(selected.netPay)} • <b>Payee:</b> {selected.name}
                    </div>
                  </div>

                  {/* QR Box */}
                  <div className="rounded-2xl border border-orange-200 bg-white p-3 text-center shadow-sm">
                    {qrCodeUrl ? (
                      <div>
                        <img src={qrCodeUrl} alt="UPI QR Code" className="h-44 w-44 mx-auto object-contain rounded-lg" />
                        <div className="mt-2 text-xs font-mono font-bold text-slate-700 truncate" title={upiInput}>
                          {upiInput}
                        </div>
                        <div className="text-sm font-black text-emerald-700 mt-0.5">
                          {inr(selected.netPay)}
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 px-4 text-xs text-slate-400">
                        Enter a valid UPI ID to generate live QR code
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Transaction Reference & Settlement Inputs */}
            <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4 space-y-3">
              <h4 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Payment Confirmation & Reference
              </h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Transaction / Reference ID (UTR)*">
                  <input
                    required
                    className={fieldClass}
                    value={payTxnId}
                    onChange={e => setPayTxnId(e.target.value)}
                    placeholder="e.g. UTR-20261026-98124 or IMPS123456"
                  />
                </Field>
                <Field label="Payment Date*">
                  <input
                    type="date"
                    required
                    className={fieldClass}
                    value={payDate}
                    onChange={e => setPayDate(e.target.value)}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Remarks / Notes (Optional)">
                    <input
                      className={fieldClass}
                      value={payRemarks}
                      onChange={e => setPayRemarks(e.target.value)}
                      placeholder="e.g. October 2026 salary payout settled"
                    />
                  </Field>
                </div>
              </div>
            </div>

            <footer className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                className={`${button} border border-slate-300 bg-white text-slate-600 hover:bg-slate-50`}
                onClick={() => setModal('')}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={paying}
                className={`${button} bg-orange-500 text-white hover:bg-orange-600 shadow-md`}
              >
                {paying ? 'Processing Payment…' : `Confirm & Pay ${inr(selected.netPay)}`}
              </button>
            </footer>
          </form>
        </ModalFrame>
      )}

      {/* Salary Payment Receipt / Payslip Modal (Task 5) */}
      {modal === 'receipt' && receiptData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-3xl my-8 rounded-3xl bg-white shadow-2xl overflow-hidden text-slate-800 border border-orange-200">
            {/* Top Action Bar (hidden on print) */}
            <div className="flex items-center justify-between bg-gradient-to-r from-orange-600 to-orange-500 px-6 py-4 text-white print:hidden">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setModal('')}
                  className="rounded-xl bg-white/20 hover:bg-white/30 px-3 py-1.5 text-xs font-black transition"
                >
                  ← Back to Payroll
                </button>
                <span className="font-extrabold text-sm sm:text-base">Salary Payment Receipt Preview</span>
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
                  onClick={() => setModal('')}
                  className="rounded-xl p-1.5 hover:bg-white/20 transition text-white"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Printable Receipt Container */}
            <div id="salary-receipt-view" className="p-8 space-y-6 bg-white print:p-6 print:border-none">
              {/* Receipt Header */}
              <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-orange-500 pb-5">
                <div>
                  <div className="inline-block rounded-xl bg-white p-2 border border-orange-100 shadow-sm">
                    <img
                      src="/mainlogo.png"
                      alt="My JEE Mentor"
                      className="h-10 w-auto object-contain"
                      onError={e => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
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
                    <strong className="font-mono text-orange-600 font-bold">{receiptData.receiptNo}</strong>
                  </div>
                  <div className="text-xs text-slate-500">
                    <span>Payment Date: </span>
                    <strong className="font-medium text-slate-700">{receiptData.paymentDate}</strong>
                  </div>
                </div>
              </div>

              {/* Staff & Payment Details Grid */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Staff Info */}
                <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-orange-800 mb-3 flex items-center gap-1.5">
                    <AdminIcon name="person" className="h-4 w-4 text-orange-600" />
                    Staff Information
                  </h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Name:</span>
                      <span className="font-bold text-slate-900">{receiptData.staff?.name}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Employee ID:</span>
                      <span className="font-mono font-semibold text-slate-800">{receiptData.staff?.employeeId || '—'}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Role / Designation:</span>
                      <span className="font-semibold text-slate-800">{receiptData.staff?.role}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Employment Model:</span>
                      <span className="font-semibold text-slate-800">{modelLabel[receiptData.staff?.model] || receiptData.staff?.employmentType}</span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-slate-500">Salary Period:</span>
                      <span className="font-extrabold text-orange-700">{receiptData.periodLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Payment Info */}
                <div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4">
                  <h3 className="text-xs font-black uppercase tracking-wider text-orange-800 mb-3 flex items-center gap-1.5">
                    <AdminIcon name="payment" className="h-4 w-4 text-orange-600" />
                    Disbursement Details
                  </h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Payment Method:</span>
                      <span className="font-extrabold text-emerald-800">{receiptData.paymentMethod}</span>
                    </div>
                    <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                      <span className="text-slate-500">Transaction ID (UTR):</span>
                      <span className="font-mono font-bold text-slate-900">{receiptData.transactionId}</span>
                    </div>
                    {receiptData.paymentMethod === 'UPI' ? (
                      <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                        <span className="text-slate-500">UPI ID / VPA:</span>
                        <span className="font-mono font-semibold text-slate-800">{receiptData.upiId || '—'}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                          <span className="text-slate-500">Bank & Branch:</span>
                          <span className="font-semibold text-slate-800">{receiptData.bankName} {receiptData.staff?.paymentDetails?.branch ? `(${receiptData.staff.paymentDetails.branch})` : ''}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                          <span className="text-slate-500">Account (Masked):</span>
                          <span className="font-mono font-semibold text-slate-800">{receiptData.accountMasked}</span>
                        </div>
                        <div className="flex justify-between py-0.5 border-b border-orange-100/60">
                          <span className="text-slate-500">IFSC Code:</span>
                          <span className="font-mono font-semibold text-slate-800">{receiptData.ifscCode || '—'}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between py-0.5">
                      <span className="text-slate-500">Disbursed By:</span>
                      <span className="font-medium text-slate-700">{receiptData.paidBy}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Work & Attendance Summary */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs flex flex-wrap items-center justify-around gap-2 text-slate-700">
                <div>Present: <b>{receiptData.staff?.presentDays} days</b> / {data?.stats.workingDays || 0} working days</div>
                <div>Attendance: <b>{receiptData.staff?.attendancePercent === null ? '—' : `${receiptData.staff.attendancePercent}%`}</b></div>
                <div>Approved Teaching: <b>{receiptData.staff?.payableHours?.toFixed(2)} hrs · {receiptData.staff?.approvedClasses} classes</b></div>
              </div>

              {/* Calculation Breakdown Table */}
              <div className="overflow-hidden rounded-2xl border border-orange-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-orange-500 text-white font-black uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3">Earnings Particulars</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                      <th className="p-3">Deductions Particulars</th>
                      <th className="p-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-orange-100">
                    <tr>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Base / Monthly Salary</div>
                        <div className="text-[10px] text-slate-500">Fixed compensation component</div>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{inr(receiptData.staff?.baseEarnings || receiptData.staff?.monthlyRate || 0)}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Provident Fund (PF)</div>
                        <div className="text-[10px] text-slate-500">{receiptData.staff?.pfPercent || 12}% statutory contribution</div>
                      </td>
                      <td className="p-3 text-right font-bold text-rose-700">{inr(receiptData.staff?.pfDeduction || 0)}</td>
                    </tr>
                    <tr>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Teaching / Hourly Earnings</div>
                        <div className="text-[10px] text-slate-500">{receiptData.staff?.payableHours?.toFixed(2)} hrs @ configured rate</div>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{inr(receiptData.staff?.teachingEarnings || 0)}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Tax Deducted at Source (TDS)</div>
                        <div className="text-[10px] text-slate-500">{receiptData.staff?.tdsPercent || 0}% income tax</div>
                      </td>
                      <td className="p-3 text-right font-bold text-rose-700">{inr(receiptData.staff?.tdsDeduction || 0)}</td>
                    </tr>
                    <tr>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Allowances & Incentives</div>
                        <div className="text-[10px] text-slate-500">Approved extra earnings</div>
                      </td>
                      <td className="p-3 text-right font-bold text-slate-800">{inr(receiptData.staff?.allowance || receiptData.staff?.otherEarnings || 0)}</td>
                      <td className="p-3">
                        <div className="font-bold text-slate-800">Advance Recoveries & Other</div>
                        <div className="text-[10px] text-slate-500">Adjustments recovered this month</div>
                      </td>
                      <td className="p-3 text-right font-bold text-rose-700">{inr((receiptData.staff?.advanceRecovery || 0) + (receiptData.staff?.otherDeductions || 0))}</td>
                    </tr>
                    <tr className="bg-orange-50/60 font-black">
                      <td className="p-3 text-slate-900 uppercase">Gross Earnings</td>
                      <td className="p-3 text-right text-slate-900">{inr(receiptData.staff?.grossPay || 0)}</td>
                      <td className="p-3 text-rose-800 uppercase">Total Deductions</td>
                      <td className="p-3 text-right text-rose-800">{inr(receiptData.staff?.totalDeductions || 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Net Salary Paid Highlight Banner */}
              <div className="rounded-2xl bg-gradient-to-r from-orange-500 to-orange-600 p-5 text-white flex flex-wrap items-center justify-between gap-4 shadow-md">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-orange-100">Net Amount Disbursed & Settled</span>
                  <h2 className="text-2xl sm:text-3xl font-black mt-0.5 tracking-tight">
                    {inr(receiptData.amount || receiptData.staff?.netPay || 0)}
                  </h2>
                  {receiptData.remarks && (
                    <p className="text-xs text-orange-100 mt-1 italic">Remarks: {receiptData.remarks}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 rounded-2xl bg-white/20 backdrop-blur-sm px-4 py-2 text-white border border-white/30">
                  <AdminIcon name="check" className="h-6 w-6 text-emerald-300" />
                  <div className="text-left">
                    <div className="text-xs font-black uppercase tracking-wider">Settlement Confirmed</div>
                    <div className="text-[10px] text-orange-100">Disbursed on {receiptData.paymentDate}</div>
                  </div>
                </div>
              </div>

              {/* Signatures & Verification */}
              <div className="pt-8 grid grid-cols-2 gap-8 text-center text-xs">
                <div>
                  <div className="border-b border-slate-300 pb-16 font-bold text-slate-400">
                    {receiptData.staff?.name}
                  </div>
                  <p className="mt-2 font-bold text-slate-700">Staff / Employee Signature</p>
                </div>
                <div>
                  <div className="border-b border-slate-300 pb-16 flex items-end justify-center">
                    <span className="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1 font-mono text-[10px] font-black text-orange-800 uppercase tracking-widest">
                      My JEE Mentor • Official Payout Seal
                    </span>
                  </div>
                  <p className="mt-2 font-bold text-slate-700">Authorised Signatory</p>
                </div>
              </div>

              {/* Footer Disclaimer */}
              <div className="border-t border-slate-100 pt-3 text-center text-[10px] text-slate-400">
                This is a computer-generated salary payment receipt from My JEE Mentor. No physical signature is required.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compensation Profile Modal */}
      {modal==='profile'&&selected&&(
        <ModalFrame title={`Compensation Profile — ${selected.name}`} onClose={()=>setModal('')}>
          <form className="space-y-4" onSubmit={saveProfile}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Compensation model">
                <select className={fieldClass} value={profile.model} onChange={e=>setProfile(p=>({...p,model:e.target.value as PayrollModel}))}>
                  <option value="monthly">Fixed monthly</option>
                  <option value="hourly">Hourly</option>
                  <option value="per_class">Per class</option>
                  <option value="per_hour">Per teaching hour</option>
                  <option value="hybrid">Monthly base + teaching hours</option>
                </select>
              </Field>
              <Field label="Effective from">
                <input className={fieldClass} type="date" required value={profile.effectiveFrom} onChange={e=>setProfile(p=>({...p,effectiveFrom:e.target.value}))}/>
              </Field>
              <Field label="Monthly / base salary (₹)">
                <input className={fieldClass} type="number" min="0" step="0.01" value={profile.monthlyRate} onChange={e=>setProfile(p=>({...p,monthlyRate:e.target.value}))}/>
              </Field>
              <Field label="Hourly rate (₹)">
                <input className={fieldClass} type="number" min="0" step="0.01" value={profile.hourlyRate} onChange={e=>setProfile(p=>({...p,hourlyRate:e.target.value}))}/>
              </Field>
              <Field label="Per class rate (₹)">
                <input className={fieldClass} type="number" min="0" step="0.01" value={profile.classRate} onChange={e=>setProfile(p=>({...p,classRate:e.target.value}))}/>
              </Field>
              <Field label="Teaching hour rate (₹)">
                <input className={fieldClass} type="number" min="0" step="0.01" value={profile.teachingHourRate} onChange={e=>setProfile(p=>({...p,teachingHourRate:e.target.value}))}/>
              </Field>
              <Field label="Monthly allowances (₹)">
                <input className={fieldClass} type="number" min="0" step="0.01" value={profile.allowance} onChange={e=>setProfile(p=>({...p,allowance:e.target.value}))}/>
              </Field>
            </div>
            <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
              <input type="checkbox" className="mt-1" checked={profile.deductUnpaidAbsences} onChange={e=>setProfile(p=>({...p,deductUnpaidAbsences:e.target.checked}))}/>
              <span><b>Deduct recorded unpaid absences</b><span className="block text-xs text-slate-600">Off by default. Paid leave and ordinary absence do not reduce monthly salary.</span></span>
            </label>
            <Field label="Reason / policy note">
              <textarea className={fieldClass} required value={profile.reason} onChange={e=>setProfile(p=>({...p,reason:e.target.value}))} rows={2}/>
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${button} border`} onClick={()=>setModal('')}>Cancel</button>
              <button disabled={saving} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>{saving?'Saving…':'Save Profile'}</button>
            </div>
          </form>
        </ModalFrame>
      )}

      {/* Record Salary Increment Modal */}
      {modal==='increment'&&(
        <ModalFrame title="Record Salary / Rate Increment" onClose={()=>setModal('')}>
          <form className="space-y-4" onSubmit={saveIncrement}>
            <Field label="Staff member">
              <select className={fieldClass} required value={selected?.id||''} onChange={e=>setSelected(findStaff(e.target.value)||null)}>
                <option value="">Select staff</option>
                {data?.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name} · {staff.employeeId||'No ID'}</option>)}
              </select>
            </Field>
            {selected && (
              <p className="rounded-xl bg-orange-50 p-3 text-sm text-orange-900">
                Current profile: {modelLabel[selected.model]} · {inr(selected.monthlyRate||selected.hourlyRate||selected.classRate||selected.teachingHourRate)}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Rate field">
                <select className={fieldClass} name="rateField">
                  <option value="monthlyRate">Monthly salary</option>
                  <option value="hourlyRate">Hourly rate</option>
                  <option value="classRate">Per class rate</option>
                  <option value="teachingHourRate">Teaching hour rate</option>
                </select>
              </Field>
              <Field label="Increase method">
                <select className={fieldClass} name="mode">
                  <option value="amount">Fixed amount (₹)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </Field>
              <Field label="Increase">
                <input className={fieldClass} type="number" name="value" min="0.01" step="0.01" required/>
              </Field>
              <Field label="Effective date">
                <input className={fieldClass} type="date" name="effectiveFrom" defaultValue={`${period}-01`} required/>
              </Field>
            </div>
            <Field label="Reason">
              <textarea className={fieldClass} name="reason" minLength={3} required rows={2}/>
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${button} border`} onClick={()=>setModal('')}>Cancel</button>
              <button className={`${button} bg-orange-500 text-white hover:bg-orange-600`} disabled={saving||!selected}>Save Increment</button>
            </div>
          </form>
        </ModalFrame>
      )}

      {/* Salary Advances Modal */}
      {modal==='advance'&&(
        <ModalFrame title="Salary Advances" onClose={()=>setModal('')} wide>
          <form onSubmit={saveAdvance} className="grid gap-3 rounded-xl border border-orange-100 bg-orange-50/40 p-4 sm:grid-cols-2">
            <Field label="Staff member">
              <select className={fieldClass} name="staffId" required defaultValue="">
                <option value="" disabled>Select staff</option>
                {data?.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select>
            </Field>
            <Field label="Advance amount (₹)">
              <input className={fieldClass} name="amount" type="number" min="0.01" step="0.01" required/>
            </Field>
            <Field label="Monthly repayment (₹)">
              <input className={fieldClass} name="repaymentAmount" type="number" min="0" step="0.01" required/>
            </Field>
            <Field label="Requested date">
              <input className={fieldClass} name="requestedDate" type="date" defaultValue={localDate()}/>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Reason">
                <input className={fieldClass} name="reason" minLength={3} required/>
              </Field>
            </div>
            <button type="submit" disabled={saving} className={`${button} bg-orange-500 text-white hover:bg-orange-600 sm:col-span-2 sm:justify-self-end`}>
              Save as Pending Approval
            </button>
          </form>
          <h3 className="mb-2 mt-5 font-black">Advance ledger</h3>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[620px] text-left text-xs">
              <thead className="bg-slate-50 font-black uppercase">
                <tr>{['Staff','Advance','Recovered','Balance','Status','Actions'].map(x=><th key={x} className="p-3">{x}</th>)}</tr>
              </thead>
              <tbody className="divide-y">
                {advanceRecords.map(row=>(
                  <tr key={row.id}>
                    <td className="p-3">{row.name}</td>
                    <td>{inr(row.amount)}</td>
                    <td>{inr(row.recovered)}</td>
                    <td className="font-bold">{inr(row.balance)}</td>
                    <td>{row.status}</td>
                    <td>
                      {row.status==='pending' && (
                        <div className="flex gap-2">
                          <button type="button" className="font-bold text-emerald-700" disabled={saving} onClick={()=>void updateAdvance(row.id,'approved')}>Approve</button>
                          <button type="button" className="font-bold text-rose-700" disabled={saving} onClick={()=>void updateAdvance(row.id,'cancelled')}>Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!advanceRecords.length && (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-500">No salary advances recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">Approved repayments are capped at the outstanding balance and recorded once per payroll run.</p>
        </ModalFrame>
      )}

      {/* Adjustments Modal */}
      {modal==='adjustment'&&selected&&(
        <ModalFrame title={`Payroll Adjustment — ${selected.name}`} onClose={()=>setModal('')}>
          <form className="space-y-4" onSubmit={saveAdjustment}>
            <Field label="Adjustment type">
              <select className={fieldClass} name="kind">
                <option value="earning">Additional earning</option>
                <option value="deduction">Deduction</option>
              </select>
            </Field>
            <Field label="Label">
              <input className={fieldClass} name="label" required maxLength={120}/>
            </Field>
            <Field label="Amount (₹)">
              <input className={fieldClass} name="amount" type="number" min="0.01" step="0.01" required/>
            </Field>
            <Field label="Reason">
              <textarea className={fieldClass} name="reason" required minLength={3} rows={3}/>
            </Field>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              Adjustments require administrator approval and are locked into a payroll snapshot once generated.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${button} border`} onClick={()=>setModal('')}>Cancel</button>
              <button disabled={saving} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Submit for Review</button>
            </div>
          </form>
        </ModalFrame>
      )}

      {/* Add Staff Work Record Modal */}
      {modal==='work'&&(
        <ModalFrame title="Add Staff Attendance / Teaching Record" onClose={()=>setModal('')}>
          <form className="space-y-4" onSubmit={saveWorkRecord}>
            <Field label="Staff member">
              <select className={fieldClass} name="staffId" required defaultValue={selected?.id||''}>
                <option value="" disabled>Select staff</option>
                {data?.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select>
            </Field>
            <Field label="Class/session ID (optional)">
              <input className={fieldClass} name="classSessionId" maxLength={160}/>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Record type">
                <select className={fieldClass} name="recordKind" value={workKind} onChange={e=>{setWorkKind(e.target.value);setWorkStatus(e.target.value==='attendance'?'present':'completed')}}>
                  <option value="attendance">Physical attendance</option>
                  <option value="teaching">Teaching session</option>
                  <option value="hourly">Hourly work</option>
                </select>
              </Field>
              <Field label="Status">
                <select className={fieldClass} name="workStatus" value={workStatus} onChange={e=>setWorkStatus(e.target.value)}>
                  {workKind==='attendance' ? (
                    <>
                      <option value="present">Present</option>
                      <option value="late">Late</option>
                      <option value="absent">Absent</option>
                      <option value="leave">Leave</option>
                      <option value="holiday">Holiday</option>
                    </>
                  ) : (
                    <>
                      <option value="completed">Completed lecture</option>
                      <option value="cancelled">Cancelled class</option>
                      <option value="rescheduled">Rescheduled class</option>
                      <option value="no_show">No-show</option>
                    </>
                  )}
                </select>
              </Field>
              <Field label="Date">
                <input className={fieldClass} name="workDate" type="date" defaultValue={localDate()} required/>
              </Field>
              <Field label="Duration (minutes)">
                <input className={fieldClass} name="minutes" type="number" min="0" max="1440" defaultValue="0" required/>
              </Field>
              <Field label="Teaching pay unit">
                <select className={fieldClass} name="payUnit">
                  <option value="hour">Per hour</option>
                  <option value="class">Per class</option>
                </select>
              </Field>
            </div>
            <Field label="Reason / session reference">
              <textarea className={fieldClass} name="reason" required minLength={3} rows={2}/>
            </Field>
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              New records are pending review and do not affect payroll until an administrator approves them.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={`${button} border`} onClick={()=>setModal('')}>Cancel</button>
              <button disabled={saving} className={`${button} bg-orange-500 text-white hover:bg-orange-600`}>Save for Review</button>
            </div>
          </form>
        </ModalFrame>
      )}

      {/* Detail Modal */}
      {modal==='detail'&&selected&&(
        <ModalFrame title={`Payroll Profile — ${selected.name}`} onClose={()=>setModal('')} wide>
          {!detail ? (
            <p role="status" className="py-8 text-center text-slate-500">Loading staff payroll details…</p>
          ) : (
            <div className="space-y-5">
              <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-4">
                  <h3 className="font-black text-slate-800">Salary Configuration</h3>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Model',modelLabel[selected.model]],
                      ['Employment Type',selected.employmentType],
                      ['Monthly / base',inr(selected.monthlyRate)],
                      ['Hourly rate',inr(selected.hourlyRate)],
                      ['Class rate',inr(selected.classRate)],
                      ['Teaching rate',inr(selected.teachingHourRate)],
                      ['Attendance',selected.attendancePercent===null?'—':`${selected.attendancePercent}%`],
                      ['Paid leave',`${selected.paidLeaveDays||0}`],
                      ['Unpaid leave',`${selected.unpaidLeaveDays||0}`],
                      ['Approved teaching',`${selected.payableHours.toFixed(2)} hours`]
                    ].map(([label,value])=>(
                      <div key={label}>
                        <span className="text-xs font-bold uppercase text-slate-400">{label}</span>
                        <p className="font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border p-4">
                  <h3 className="font-black">Quick Summary</h3>
                  <p className="mt-3">Present days <b>{selected.presentDays}</b></p>
                  <p>Gross preview <b>{inr(selected.grossPay)}</b></p>
                  <p>Deductions <b>{inr(selected.totalDeductions)}</b></p>
                  <p>Net preview <b>{inr(selected.netPay)}</b></p>
                  <button className={`${button} mt-3 w-full bg-orange-500 text-white hover:bg-orange-600`} onClick={()=>openProfile(selected)}>
                    Edit Profile
                  </button>
                </div>
              </section>

              <section className="rounded-xl border">
                <h3 className="border-b bg-orange-50/50 p-3 font-black text-slate-800">Work & Attendance Review</h3>
                {detail.workRecords.map(row=>(
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b p-3 text-sm">
                    <span><b>{row.kind}</b> · {row.date} · {row.status} · {row.source} · {row.minutes} min {row.reason&&`· ${row.reason}`}</span>
                    {row.status==='pending' && (
                      <button className="font-bold text-emerald-700 underline" disabled={saving} onClick={()=>void approveWork(row.id)}>
                        Verify & Approve
                      </button>
                    )}
                    {row.source==='zoom'&&row.record_json?.isMapping && (
                      <button className="font-bold text-orange-600 underline" onClick={()=>void syncZoom(row.id)}>
                        Sync Zoom report
                      </button>
                    )}
                  </div>
                ))}
                {!detail.workRecords.length && <p className="p-5 text-center text-sm text-slate-500">No attendance or teaching records yet.</p>}
              </section>

              <section className="rounded-xl border">
                <h3 className="border-b bg-orange-50/50 p-3 font-black text-slate-800">Payroll Adjustments</h3>
                {detail.adjustments.map(row=>(
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
                    <span><b>{row.label}</b> - {row.kind} - {inr(row.amount)} - {row.periodStart} - {row.reason} - {row.status}</span>
                    {row.status==="pending" && (
                      <span className="flex gap-3">
                        <button type="button" className="font-bold text-emerald-700 underline" disabled={saving} onClick={()=>void reviewAdjustment(row.id,"approved")}>Approve</button>
                        <button type="button" className="font-bold text-rose-700 underline" disabled={saving} onClick={()=>void reviewAdjustment(row.id,"rejected")}>Reject</button>
                      </span>
                    )}
                  </div>
                ))}
                {!detail.adjustments.length && <p className="p-4 text-sm text-slate-500">No payroll adjustments recorded for this staff member.</p>}
              </section>

              <section className="rounded-xl border">
                <h3 className="border-b bg-orange-50/50 p-3 font-black text-slate-800">Compensation History</h3>
                {detail.compensationHistory.map(row=>(
                  <div key={row.id} className="flex flex-wrap justify-between gap-2 border-b p-3 text-sm">
                    <span>{modelLabel[row.model]} · Effective {row.effectiveFrom}{row.effectiveTo?` to ${row.effectiveTo}`:''} · {row.reason}</span>
                    <b>{inr(row.monthlyRate||row.hourlyRate||row.classRate||row.teachingHourRate)}</b>
                  </div>
                ))}
                {!detail.compensationHistory.length && <p className="p-5 text-sm text-slate-500">Current compensation is using the existing staff profile values.</p>}
              </section>

              <section className="rounded-xl border">
                <h3 className="border-b bg-orange-50/50 p-3 font-black text-slate-800">Payslip & Payroll History</h3>
                {detail.payrollHistory.map(row=>(
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b p-3 text-sm">
                    <span>{row.periodStart?new Date(`${row.periodStart}T00:00:00`).toLocaleDateString('en-IN',{month:'long',year:'numeric'}):'Legacy entry'} · {row.status}</span>
                    <span>Gross {inr(row.grossPay)} · Deductions {inr(row.deductions)} · <b>Net {inr(row.netPay)}</b></span>
                    <button className="font-bold text-orange-600 underline" onClick={()=>window.print()}>Print</button>
                  </div>
                ))}
                {!detail.payrollHistory.length && <p className="p-5 text-sm text-slate-500">No payroll records saved yet.</p>}
              </section>
            </div>
          )}
        </ModalFrame>
      )}

      {/* History Modal */}
      {modal==='history'&&<ModalFrame title="Saved Payroll Snapshot" onClose={()=>setModal('')} wide>{!runDetail?<p role="status" className="py-8 text-center text-slate-500">Loading saved payroll snapshot…</p>:<div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><Stat label="PERIOD" value={new Date(`${runDetail.run.periodStart}T00:00:00`).toLocaleDateString('en-IN',{month:'short',year:'numeric'})} icon="calendar"/><Stat label="STAFF" value={runDetail.records.length} icon="person"/><Stat label="GROSS" value={inr(runDetail.run.grossTotal)} icon="payment" tone="green"/><Stat label="NET PAYABLE" value={inr(runDetail.run.netTotal)} icon="trend" tone="teal"/></div><p className="text-sm text-slate-600">Status: <b className="uppercase">{runDetail.run.status}</b>. This view uses the saved compensation and work snapshot for this run.</p><div className="overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-orange-50 font-black uppercase text-slate-800"><tr>{['Staff','Attendance','Payable hours','Gross','Deductions','Net','Breakdown'].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody className="divide-y">{runDetail.records.map(row=><tr key={row.id}><td className="p-3"><b>{row.name}</b><div>{row.employeeId}</div></td><td>{row.attendanceDays}</td><td>{Number(row.payableHours).toFixed(2)}</td><td>{inr(row.grossPay)}</td><td className="text-rose-700">{inr(row.deductions)}</td><td className="font-bold text-emerald-700">{inr(row.netPay)}</td><td><button className="font-bold text-orange-600 underline" onClick={()=>window.alert(JSON.stringify(row.breakdown,null,2))}>Calculation</button></td></tr>)}</tbody></table></div></div>}</ModalFrame>}

      {/* Settlement Modal */}
      {modal==='settle'&&<ModalFrame title="Record Payroll Settlement" onClose={()=>setModal('')}><form className="space-y-4" onSubmit={saveSettlement}><p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Settlement is a manual record. Do not mark this as settled until the payment has been verified.</p><p className="rounded-lg bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Settlement amount: {inr(data?.run?.netTotal||0)}</p><Field label="Payment date"><input className={fieldClass} name="paymentDate" type="date" defaultValue={localDate()} required/></Field><Field label="Payment method"><select className={fieldClass} name="paymentMethod"><option value="bank transfer">Bank transfer</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="online">Other online</option></select></Field><Field label="Payment reference (UTR / Transaction ID)"><input className={fieldClass} name="paymentReference" required minLength={2}/></Field><Field label="Notes"><textarea className={fieldClass} name="reason" rows={2}/></Field><div className="flex justify-end gap-2"><button type="button" className={`${button} border`} onClick={()=>setModal('')}>Cancel</button><button disabled={saving} className={`${button} bg-emerald-600 text-white`}>Record Settlement</button></div></form></ModalFrame>}

      {/* Zoom Modal */}
      {modal==='zoom'&&<ModalFrame title="Zoom Attendance Integration" onClose={()=>setModal('')}><p className="text-sm text-slate-600">Zoom keys remain server-side in the existing encrypted integration connection. Signed webhooks and the participant report require Zoom Server-to-Server OAuth credentials and the webhook secret configured by your administrator.</p><div className="my-4 rounded-xl border border-orange-100 bg-orange-50 p-3 text-sm"><b>Webhook endpoint:</b><code className="ml-2 break-all">/api/webhooks/zoom</code><p className="mt-2">Webhook secret configured: <b>{data?.zoom.webhookReady?'Yes':'No'}</b> · Zoom credentials saved: <b>{data?.zoom.configured?'Yes':'No'}</b></p><p className="mt-2 text-xs">Participant reports are matched only using the staff member email already saved in their profile. Unmatched reports remain pending for manual review.</p></div><form className="space-y-3" onSubmit={saveZoomMapping}><h3 className="font-black text-slate-800">Map an existing Zoom meeting</h3><Field label="Staff member"><select className={fieldClass} name="staffId" required defaultValue=""><option value="" disabled>Select staff</option>{data?.staff.map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></Field><Field label="Zoom meeting ID or UUID"><input className={fieldClass} name="meetingId" required/></Field><Field label="Scheduled class/session ID (optional)"><input className={fieldClass} name="classSessionId"/></Field><div className="grid gap-3 sm:grid-cols-2"><Field label="Class date"><input className={fieldClass} name="workDate" type="date" defaultValue={localDate()} required/></Field><Field label="Expected duration (minutes)"><input className={fieldClass} name="durationMinutes" type="number" min="1" max="720" defaultValue="60" required/></Field></div><Field label="Pay unit"><select className={fieldClass} name="payUnit"><option value="hour">Per teaching hour</option><option value="class">Per class</option></select></Field><div className="flex justify-between gap-2"><a className={`${button} border border-orange-200 text-orange-600`} href="/admin/integrations">Open Integrations</a><button className={`${button} bg-orange-500 text-white hover:bg-orange-600`} disabled={saving}>Save Meeting Mapping</button></div></form></ModalFrame>}
    </div>
  );
}
