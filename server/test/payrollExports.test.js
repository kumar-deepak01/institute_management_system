'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createPayslipPdf, createZipArchive } = require('../src/controllers/payrollController');

test('payslip export is a PDF made from a saved payroll snapshot', () => {
  const pdf = createPayslipPdf({ period_start: '2026-10-01', status: 'draft' }, {
    status: 'draft', employee_id: 'EMP-1', gross_pay: 45000, deductions: 6300, net_pay: 38700,
    attendance_days: 27, payable_hours: 0,
    snapshot_json: { name: 'Priya Mehta', employeeId: 'EMP-1', employmentType: 'Full-Time', model: 'monthly', pfPercent: 12, tdsPercent: 2, presentDays: 27, calculation: { pfDeduction: 5400, tdsDeduction: 900 } },
  });
  assert.equal(pdf.subarray(0, 8).toString('ascii'), '%PDF-1.4');
  assert.ok(pdf.toString('ascii').includes('Net pay: INR 38700.00'));
});

test('payslip archive is a readable ZIP containing the PDF entry', () => {
  const pdf = createPayslipPdf({ period_start: '2026-10-01', status: 'draft' }, { gross_pay: 100, deductions: 0, net_pay: 100, snapshot_json: {} });
  const archive = createZipArchive([{ name: 'payslip-record.pdf', data: pdf }]);
  assert.equal(archive.readUInt32LE(0), 0x04034B50);
  assert.equal(archive.readUInt32LE(archive.length - 22), 0x06054B50);
  const compressedSize = archive.readUInt32LE(18);
  const uncompressedSize = archive.readUInt32LE(22);
  const nameLength = archive.readUInt16LE(26);
  const extraLength = archive.readUInt16LE(28);
  const contents = zlib.inflateRawSync(archive.subarray(30 + nameLength + extraLength, 30 + nameLength + extraLength + compressedSize));
  assert.equal(contents.toString('ascii', 0, 8), '%PDF-1.4');
  assert.equal(contents.length, uncompressedSize);
});
