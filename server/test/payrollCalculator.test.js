'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePayroll } = require('../src/services/payrollCalculator');

test('monthly salary is not reduced for unconfigured absence or paid leave', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '45000', workingDays: 27, unpaidAbsenceDays: 4 });
  assert.equal(result.baseEarnings, 45000);
  assert.equal(result.netPay, 45000);
});

test('monthly salary prorates only when the unpaid absence policy is explicitly enabled', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '27000', workingDays: 27, unpaidAbsenceDays: 3, attendancePolicy: { deductUnpaidAbsences: true } });
  assert.equal(result.baseEarnings, 24000);
});

test('hourly work uses approved minutes and cents precision', () => {
  const result = calculatePayroll({ model: 'hourly', hourlyRate: '500', approvedMinutes: 90 });
  assert.equal(result.teachingEarnings, 750);
});

test('class pay counts eligible approved classes, not scheduled minutes', () => {
  const result = calculatePayroll({ model: 'per_class', classRate: '500', approvedClasses: 4, approvedMinutes: 360 });
  assert.equal(result.teachingEarnings, 2000);
});

test('hour based lecture pay uses actual payable duration', () => {
  const result = calculatePayroll({ model: 'per_hour', teachingHourRate: '500', approvedMinutes: 360 });
  assert.equal(result.teachingEarnings, 3000);
});

test('hybrid salary includes the monthly base and approved per-class teaching', () => {
  const result = calculatePayroll({ model: 'hybrid', monthlyRate: '30000', classRate: '500', workingDays: 26, approvedClasses: 3 });
  assert.equal(result.grossPay, 31500);
});

test('deductions cannot make net pay negative and zero-pay rows remain valid', () => {
  assert.equal(calculatePayroll({ model: 'monthly', monthlyRate: '0', workingDays: 26, deductions: [{ amount: '10' }] }).netPay, 0);
  assert.equal(calculatePayroll({ model: 'monthly', monthlyRate: '100.10', workingDays: 26, deductions: [{ amount: '0.10' }] }).netPay, 100);
});

test('monthly allowances and approved earnings are included in gross pay', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '20000', allowance: '1500.25', workingDays: 26, earnings: [{ amount: '500.50' }] });
  assert.equal(result.grossPay, 22000.75);
});

test('pending, rejected and unapproved work contributes no pay when payable minutes are zero', () => {
  const result = calculatePayroll({ model: 'hourly', hourlyRate: '600', approvedMinutes: 0 });
  assert.equal(result.teachingEarnings, 0);
});

test('hybrid salary pays every approved class at the configured class rate', () => {
  const result = calculatePayroll({ model: 'hybrid', monthlyRate: '25000', classRate: '700', workingDays: 25, approvedClasses: 3 });
  assert.equal(result.grossPay, 27100);
});

test('hybrid pay ignores scheduled class counts until the records are approved', () => {
  const result = calculatePayroll({ model: 'hybrid', monthlyRate: '25000', classRate: '700', workingDays: 25, approvedClasses: 0 });
  assert.equal(result.grossPay, 25000);
});

test('advance recovery is a deduction and cannot exceed the supplied recovery amount', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '30000', workingDays: 26, advanceRecovery: '1200' });
  assert.equal(result.advanceRecovery, 1200);
  assert.equal(result.netPay, 28800);
});

test('paise rounding is consistent for fractional hourly rates', () => {
  const result = calculatePayroll({ model: 'hourly', hourlyRate: '99.99', approvedMinutes: 1 });
  assert.equal(result.teachingEarnings, 1.67);
});

test('unpaid absence deductions are capped at all working days', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '27000', workingDays: 27, unpaidAbsenceDays: 40, attendancePolicy: { deductUnpaidAbsences: true } });
  assert.equal(result.baseEarnings, 0);
});

test('ordinary absence does not reduce hybrid base pay without the explicit policy', () => {
  const result = calculatePayroll({ model: 'hybrid', monthlyRate: '27000', workingDays: 27, unpaidAbsenceDays: 4 });
  assert.equal(result.baseEarnings, 27000);
});

test('unknown models do not create accidental teaching or monthly earnings', () => {
  const result = calculatePayroll({ model: 'unknown', monthlyRate: '20000', hourlyRate: '500', approvedMinutes: 60 });
  assert.equal(result.grossPay, 0);
});

test('invalid numeric input safely contributes zero', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: 'not-money', allowance: '-50', workingDays: 26 });
  assert.equal(result.grossPay, 0);
});

test('advance recovery and deductions are both included in total deductions', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '10000', workingDays: 25, deductions: [{ amount: '250' }], advanceRecovery: '750' });
  assert.equal(result.totalDeductions, 1000);
  assert.equal(result.netPay, 9000);
});

test('configured PF and TDS percentages are calculated from gross pay', () => {
  const result = calculatePayroll({ model: 'monthly', monthlyRate: '45000', workingDays: 27, pfPercent: '12', tdsPercent: '2' });
  assert.equal(result.pfDeduction, 5400);
  assert.equal(result.tdsDeduction, 900);
  assert.equal(result.totalDeductions, 6300);
  assert.equal(result.netPay, 38700);
});
