'use strict';

function cents(value) {
  const text = String(value ?? 0).trim();
  if (!/^\d{1,12}(?:\.\d{1,6})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  const rounded = `${fraction}00`.slice(0, 3);
  let result = BigInt(whole) * 100n + BigInt(rounded.slice(0, 2));
  if (Number(rounded[2] || 0) >= 5) result += 1n;
  return result;
}

function money(value) { return Number(value) / 100; }
function ratioRounded(numerator, denominator) {
  if (!denominator) return 0n;
  return (numerator + denominator / 2n) / denominator;
}

function calculatePayroll(input) {
  const model = input.model || 'monthly';
  const monthly = cents(input.monthlyRate);
  const hourly = cents(input.hourlyRate || input.teachingHourRate);
  const classRate = cents(input.classRate);
  const allowance = cents(input.allowance);
  const pfRate = cents(input.pfPercent);
  const tdsRate = cents(input.tdsPercent);
  const minutes = BigInt(Math.max(0, Math.trunc(Number(input.approvedMinutes) || 0)));
  const classes = BigInt(Math.max(0, Math.trunc(Number(input.approvedClasses) || 0)));
  const workingDays = BigInt(Math.max(0, Math.trunc(Number(input.workingDays) || 0)));
  const unpaidDays = BigInt(Math.max(0, Math.trunc(Number(input.unpaidAbsenceDays) || 0)));
  const deductUnpaid = input.attendancePolicy?.deductUnpaidAbsences === true;
  const payableMonthlyDays = deductUnpaid ? (workingDays > unpaidDays ? workingDays - unpaidDays : 0n) : workingDays;

  let base = 0n;
  if (model === 'monthly' || model === 'hybrid') {
    base = workingDays ? ratioRounded(monthly * payableMonthlyDays, workingDays) : monthly;
  }
  let teaching = 0n;
  if (model === 'hourly' || model === 'per_hour') teaching = ratioRounded(hourly * minutes, 60n);
  if (model === 'per_class') teaching = classRate * classes;
  if (model === 'hybrid') teaching = classRate * classes;

  const earnings = Array.isArray(input.earnings) ? input.earnings.reduce((sum, row) => sum + cents(row.amount), 0n) : 0n;
  const deductions = Array.isArray(input.deductions) ? input.deductions.reduce((sum, row) => sum + cents(row.amount), 0n) : 0n;
  const advanceRecovery = cents(input.advanceRecovery);
  const gross = base + teaching + allowance + earnings;
  const pfDeduction = ratioRounded(gross * pfRate, 10000n);
  const tdsDeduction = ratioRounded(gross * tdsRate, 10000n);
  const totalDeductions = deductions + advanceRecovery + pfDeduction + tdsDeduction;
  const net = gross > totalDeductions ? gross - totalDeductions : 0n;
  return {
    model,
    workingDays: Number(workingDays),
    unpaidAbsenceDays: Number(unpaidDays),
    approvedMinutes: Number(minutes),
    payableHours: Number(minutes) / 60,
    approvedClasses: Number(classes),
    baseEarnings: money(base),
    teachingEarnings: money(teaching),
    allowances: money(allowance),
    otherEarnings: money(earnings),
    otherDeductions: money(deductions),
    pfPercent: money(pfRate),
    pfDeduction: money(pfDeduction),
    tdsPercent: money(tdsRate),
    tdsDeduction: money(tdsDeduction),
    advanceRecovery: money(advanceRecovery),
    grossPay: money(gross),
    totalDeductions: money(totalDeductions),
    netPay: money(net),
    attendancePolicyApplied: deductUnpaid,
  };
}

module.exports = { calculatePayroll, cents };
