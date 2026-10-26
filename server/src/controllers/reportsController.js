const { getPool, queryWithLimit } = require('../services/postgresStore');
const { send, authenticate, validCsrfRequest } = require('../middleware/http');

const clean = (val, max = 240) => String(val ?? '').trim().slice(0, max);
const dateOk = (val) => /^\d{4}-\d{2}-\d{2}$/.test(val);

function csvCell(val) {
  const text = String(val ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvResponse(res, rows, filename) {
  const content = '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');
  const buffer = Buffer.from(content, 'utf8');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  return res.end(buffer);
}

// 1. Top Stat Strip
async function getReportStats(req, res) {
  const pool = getPool();
  try {
    const [studentsRes, revenueRes, attendanceRes, billedRes, atRiskRes] = await Promise.all([
      queryWithLimit(() => pool.query(`select count(*)::int as count from public.students where lower(coalesce(status,'active')) not in ('inactive','left','dropped','deleted','archived')`)),
      queryWithLimit(() => pool.query(`select coalesce(sum(amount), 0)::numeric as collected from public.fee_payments where reversed_at is null`)),
      queryWithLimit(() => pool.query(`select count(*)::int as total, count(*) filter (where status in ('present','Late','Taken'))::int as present from public.live_class_joins`)),
      queryWithLimit(() => pool.query(`select coalesce(sum(total_amount), 0)::numeric as billed from public.student_fees`)),
      queryWithLimit(() => pool.query(`select count(*)::int as count from public.students where lower(coalesce(status,'active')) = 'active' and (risk = 'High' or risk = 'Medium')`))
    ]);

    const totalStudents = Number(studentsRes.rows[0]?.count || 0);
    const totalRevenue = Number(revenueRes.rows[0]?.collected || 0);
    const totalBilled = Number(billedRes.rows[0]?.billed || 0);
    const atRiskCount = Number(atRiskRes.rows[0]?.count || 0);

    const attTotal = Number(attendanceRes.rows[0]?.total || 0);
    const attPresent = Number(attendanceRes.rows[0]?.present || 0);
    const attendancePct = attTotal > 0 ? Math.round((attPresent / attTotal) * 100) : 0;

    const collectionRate = totalBilled > 0 ? Math.round((totalRevenue / totalBilled) * 1000) / 10 : (totalRevenue > 0 ? 100 : 0);

    // Format revenue compactly: e.g. ₹5.0K or ₹1.2M
    let revenueFormatted = '₹0';
    if (totalRevenue >= 10000000) revenueFormatted = `₹${(totalRevenue / 10000000).toFixed(1)}Cr`;
    else if (totalRevenue >= 100000) revenueFormatted = `₹${(totalRevenue / 100000).toFixed(1)}L`;
    else if (totalRevenue >= 1000) revenueFormatted = `₹${(totalRevenue / 1000).toFixed(1)}K`;
    else revenueFormatted = `₹${totalRevenue.toLocaleString('en-IN')}`;

    return send(res, 200, {
      students: totalStudents,
      revenue: revenueFormatted,
      rawRevenue: totalRevenue,
      exams: 0,
      attendance: `${attendancePct}%`,
      feeCollectionRate: `${collectionRate}%`,
      atRisk: atRiskCount
    });
  } catch (error) {
    console.error('[reports] getReportStats error:', error);
    return send(res, 500, { error: 'Failed to load report stats.' });
  }
}

// 2. Fee Collection Report
async function getFeeCollectionReport(req, res, url) {
  const pool = getPool();
  try {
    const fromDate = clean(url.searchParams.get('from'), 10);
    const toDate = clean(url.searchParams.get('to'), 10);
    const batchId = clean(url.searchParams.get('batchId'), 120);

    const d = new Date();
    const defaultFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultTo = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const from = dateOk(fromDate) ? fromDate : defaultFrom;
    const to = dateOk(toDate) ? toDate : defaultTo;

    const [batchesRes, transactionsRes, monthlyRes] = await Promise.all([
      queryWithLimit(() => pool.query(`select id, name from public.batches order by name`)),
      queryWithLimit(() => pool.query(`
        select
          fp.id, fp.amount, coalesce(fp.fine_amount, 0)::numeric as fine_amount, fp.method,
          fp.receipt_no, fp.paid_at, coalesce(acc.name, fp.received_by, 'Admin') as recorded_by,
          coalesce(st.name, 'Student') as student_name,
          st.admission_number,
          coalesce(b.name, 'All Batches') as batch_name,
          coalesce(sf.title, 'Tuition Fee') as fee_title,
          b.id as batch_id
        from public.fee_payments fp
        left join public.student_fees sf on sf.id = fp.student_fee_id
        left join public.students st on st.id = fp.student_key or st.student_key = fp.student_key
        left join public.batches b on b.id = sf.batch_id or b.id = st.batch_id
        left join public.accounts acc on acc.email = fp.received_by or acc.id = fp.received_by
        where fp.reversed_at is null
          and (fp.paid_at at time zone 'Asia/Kolkata')::date between $1::date and $2::date
          and ($3 = '' or b.id = $3 or sf.batch_id = $3 or st.batch_id = $3)
        order by fp.paid_at desc
        limit 1000
      `, [from, to, batchId])),
      queryWithLimit(() => pool.query(`
        select
          to_char(paid_at at time zone 'Asia/Kolkata', 'Mon YYYY') as month_label,
          to_char(paid_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month_key,
          sum(amount)::numeric as total_amount
        from public.fee_payments
        where reversed_at is null
        group by month_key, month_label
        order by month_key desc
        limit 6
      `))
    ]);

    const txns = transactionsRes.rows || [];
    let totalCollected = 0;
    let fineCollected = 0;
    const byBatchMap = new Map();
    const byMethodMap = new Map();

    for (const t of txns) {
      const amt = Number(t.amount || 0);
      const fine = Number(t.fine_amount || 0);
      totalCollected += amt;
      fineCollected += fine;

      // Batch aggregation
      const bName = t.batch_name || 'All Batches';
      if (!byBatchMap.has(bName)) byBatchMap.set(bName, { batch: bName, collected: 0, txns: 0 });
      const bObj = byBatchMap.get(bName);
      bObj.collected += amt;
      bObj.txns += 1;

      // Method aggregation
      const mName = (t.method || 'cash').toUpperCase();
      if (!byMethodMap.has(mName)) byMethodMap.set(mName, { method: mName, collected: 0, txns: 0 });
      const mObj = byMethodMap.get(mName);
      mObj.collected += amt;
      mObj.txns += 1;
    }

    const txnCount = txns.length;
    const avgTransaction = txnCount > 0 ? Math.round(totalCollected / txnCount) : 0;

    // Monthly Trend
    const monthlyTrendRows = (monthlyRes.rows || []).reverse();
    const maxMonthAmt = Math.max(...monthlyTrendRows.map(r => Number(r.total_amount || 0)), 1);
    const monthlyTrend = monthlyTrendRows.map(r => ({
      month: r.month_label,
      amount: Number(r.total_amount || 0),
      progressPct: Math.round((Number(r.total_amount || 0) / maxMonthAmt) * 100)
    }));

    const formattedTransactions = txns.map(t => {
      const dt = new Date(t.paid_at);
      const formattedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(dt);
      return {
        id: t.id,
        studentName: t.student_name,
        admissionNumber: t.admission_number || '',
        batch: t.batch_name,
        feeTitle: t.fee_title,
        principal: Number(t.amount || 0),
        fine: Number(t.fine_amount || 0),
        method: t.method ? t.method.charAt(0).toUpperCase() + t.method.slice(1).toLowerCase() : 'Cash',
        date: formattedDate,
        recordedBy: t.recorded_by,
        receiptNo: t.receipt_no
      };
    });

    return send(res, 200, {
      from,
      to,
      batchId,
      batches: batchesRes.rows || [],
      kpis: {
        totalCollected,
        transactions: txnCount,
        avgTransaction,
        fineCollected
      },
      byBatch: Array.from(byBatchMap.values()),
      byMethod: Array.from(byMethodMap.values()),
      monthlyTrend,
      transactions: formattedTransactions
    });
  } catch (error) {
    console.error('[reports] getFeeCollectionReport error:', error);
    return send(res, 500, { error: 'Failed to load fee collection report.' });
  }
}

// 3. Fee Defaulters Report
async function getFeeDefaultersReport(req, res, url) {
  const pool = getPool();
  try {
    const batchId = clean(url.searchParams.get('batchId'), 120);
    const [batchesRes, defaultersRes] = await Promise.all([
      queryWithLimit(() => pool.query(`select id, name from public.batches order by name`)),
      queryWithLimit(() => pool.query(`
        select
          sf.id, sf.title as fee_title, sf.total_amount, sf.due_date, sf.status,
          coalesce(paid.amount_paid, 0)::numeric as paid_amount,
          (sf.total_amount - coalesce(paid.amount_paid, 0))::numeric as outstanding_amount,
          s.name as student_name, s.phone as student_phone, s.email as student_email, s.admission_number,
          b.name as batch_name, b.id as batch_id
        from public.student_fees sf
        join public.students s on s.id = sf.student_key or s.student_key = sf.student_key
        left join public.batches b on b.id = sf.batch_id or b.id = s.batch_id
        left join (
          select student_fee_id, sum(amount)::numeric as amount_paid
          from public.fee_payments where reversed_at is null
          group by student_fee_id
        ) paid on paid.student_fee_id = sf.id
        where sf.total_amount > coalesce(paid.amount_paid, 0)
          and sf.due_date < current_date
          and ($1 = '' or b.id = $1 or sf.batch_id = $1)
        order by (sf.total_amount - coalesce(paid.amount_paid, 0)) desc
        limit 500
      `, [batchId]))
    ]);

    const records = defaultersRes.rows.map(r => {
      const dueDt = new Date(r.due_date);
      const daysOverdue = Math.max(0, Math.floor((Date.now() - dueDt.getTime()) / (1000 * 60 * 60 * 24)));
      return {
        id: r.id,
        studentName: r.student_name,
        admissionNumber: r.admission_number || '',
        phone: r.student_phone || '—',
        email: r.student_email || '—',
        batchName: r.batch_name || 'All Batches',
        feeTitle: r.fee_title,
        dueDate: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(dueDt),
        daysOverdue,
        totalBilled: Number(r.total_amount),
        paidAmount: Number(r.paid_amount),
        outstandingAmount: Number(r.outstanding_amount)
      };
    });

    const totalOverdue = records.reduce((sum, r) => sum + r.outstandingAmount, 0);

    return send(res, 200, {
      batches: batchesRes.rows || [],
      kpis: {
        defaultersCount: records.length,
        totalOverdue,
        avgOverdue: records.length ? Math.round(totalOverdue / records.length) : 0
      },
      records
    });
  } catch (error) {
    console.error('[reports] getFeeDefaultersReport error:', error);
    return send(res, 500, { error: 'Failed to load fee defaulters report.' });
  }
}

// 4. Student Assigned Subjects Report
async function getStudentSubjectsReport(req, res, url) {
  const pool = getPool();
  try {
    const batchId = clean(url.searchParams.get('batchId'), 120);
    const [batchesRes, studentsRes] = await Promise.all([
      queryWithLimit(() => pool.query(`select id, name from public.batches order by name`)),
      queryWithLimit(() => pool.query(`
        select
          s.id, s.name, s.admission_number, s.email, s.phone,
          b.name as batch_name, c.name as course_name, b.id as batch_id,
          coalesce(
            (
              select jsonb_agg(jsonb_build_object('id', sub.id, 'name', sub.name, 'code', sub.code))
              from public.staff_subject_assignments ssa
              join public.subjects sub on sub.id = ssa.subject_id
              where ssa.batch_id = s.batch_id
            ), '[]'::jsonb
          ) as assigned_subjects
        from public.students s
        left join public.batches b on b.id = s.batch_id
        left join public.courses c on c.id = s.course_id
        where lower(coalesce(s.status, 'active')) = 'active'
          and ($1 = '' or s.batch_id = $1)
        order by s.name
        limit 500
      `, [batchId]))
    ]);

    const records = studentsRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      admissionNumber: r.admission_number || '—',
      email: r.email || '—',
      phone: r.phone || '—',
      batch: r.batch_name || '—',
      course: r.course_name || '—',
      subjects: Array.isArray(r.assigned_subjects) ? r.assigned_subjects.map(s => s.name).join(', ') || 'No subjects assigned' : 'No subjects assigned'
    }));

    return send(res, 200, {
      batches: batchesRes.rows || [],
      kpis: {
        totalStudents: records.length,
        withSubjects: records.filter(r => r.subjects !== 'No subjects assigned').length
      },
      records
    });
  } catch (error) {
    console.error('[reports] getStudentSubjectsReport error:', error);
    return send(res, 500, { error: 'Failed to load student assigned subjects report.' });
  }
}

// 5. Enrollment Report
async function getEnrollmentReport(req, res) {
  const pool = getPool();
  try {
    const [monthlyRes, batchStrengthRes] = await Promise.all([
      queryWithLimit(() => pool.query(`
        select
          to_char(created_at at time zone 'Asia/Kolkata', 'Mon YYYY') as month_label,
          to_char(created_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month_key,
          count(*)::int as count
        from public.students
        group by month_key, month_label
        order by month_key desc
        limit 12
      `)),
      queryWithLimit(() => pool.query(`
        select
          b.name as batch_name, count(s.id)::int as count
        from public.batches b
        left join public.students s on s.batch_id = b.id and lower(coalesce(s.status, 'active')) = 'active'
        group by b.id, b.name
        order by count desc
      `))
    ]);

    const monthlyTrends = (monthlyRes.rows || []).reverse();
    const totalEnrollments = monthlyTrends.reduce((sum, r) => sum + Number(r.count), 0);

    return send(res, 200, {
      kpis: {
        totalAdmissions: totalEnrollments,
        totalBatches: batchStrengthRes.rows.length
      },
      monthlyTrends,
      batchStrengths: batchStrengthRes.rows || []
    });
  } catch (error) {
    console.error('[reports] getEnrollmentReport error:', error);
    return send(res, 500, { error: 'Failed to load enrollment report.' });
  }
}

// 6. Dropout Analysis Report
async function getDropoutReport(req, res) {
  const pool = getPool();
  try {
    const dropoutsRes = await queryWithLimit(() => pool.query(`
      select
        s.id, s.name, s.admission_number, s.email, s.phone, s.status,
        b.name as batch_name, s.created_at, s.updated_at
      from public.students s
      left join public.batches b on b.id = s.batch_id
      where lower(coalesce(s.status, '')) in ('inactive', 'dropped', 'left', 'archived')
      order by s.updated_at desc
      limit 500
    `));

    const records = dropoutsRes.rows.map(r => ({
      id: r.id,
      name: r.name,
      admissionNumber: r.admission_number || '—',
      email: r.email || '—',
      phone: r.phone || '—',
      batch: r.batch_name || '—',
      status: r.status,
      joinedDate: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.created_at)),
      dropDate: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.updated_at))
    }));

    return send(res, 200, {
      kpis: {
        dropoutsCount: records.length
      },
      records
    });
  } catch (error) {
    console.error('[reports] getDropoutReport error:', error);
    return send(res, 500, { error: 'Failed to load dropout report.' });
  }
}

// 7. Revenue Report
async function getRevenueReport(req, res) {
  const pool = getPool();
  try {
    const [monthlyFeeRes, monthlyIncomeRes, monthlyExpenseRes] = await Promise.all([
      queryWithLimit(() => pool.query(`
        select
          to_char(paid_at at time zone 'Asia/Kolkata', 'Mon YYYY') as month_label,
          to_char(paid_at at time zone 'Asia/Kolkata', 'YYYY-MM') as month_key,
          sum(amount)::numeric as fees_total
        from public.fee_payments where reversed_at is null
        group by month_key, month_label order by month_key desc limit 12
      `)),
      queryWithLimit(() => pool.query(`
        select
          to_char(received_date, 'Mon YYYY') as month_label,
          to_char(received_date, 'YYYY-MM') as month_key,
          sum(amount)::numeric as income_total
        from public.income_records
        group by month_key, month_label order by month_key desc limit 12
      `)),
      queryWithLimit(() => pool.query(`
        select
          to_char(expense_date, 'Mon YYYY') as month_label,
          to_char(expense_date, 'YYYY-MM') as month_key,
          sum(amount)::numeric as expense_total
        from public.expenses
        group by month_key, month_label order by month_key desc limit 12
      `))
    ]);

    const feeMap = new Map((monthlyFeeRes.rows || []).map(r => [r.month_key, { label: r.month_label, fees: Number(r.fees_total) }]));
    const incMap = new Map((monthlyIncomeRes.rows || []).map(r => [r.month_key, Number(r.income_total)]));
    const expMap = new Map((monthlyExpenseRes.rows || []).map(r => [r.month_key, Number(r.expense_total)]));

    const allKeys = Array.from(new Set([...feeMap.keys(), ...incMap.keys(), ...expMap.keys()])).sort().reverse();
    const records = allKeys.map(k => {
      const fees = feeMap.get(k)?.fees || 0;
      const otherIncome = incMap.get(k) || 0;
      const expense = expMap.get(k) || 0;
      const totalRev = fees + otherIncome;
      const net = totalRev - expense;
      const label = feeMap.get(k)?.label || k;
      return {
        monthKey: k,
        monthLabel: label,
        feeRevenue: fees,
        otherIncome,
        totalRevenue: totalRev,
        expense,
        netProfit: net
      };
    });

    const totalFees = records.reduce((s, r) => s + r.feeRevenue, 0);
    const totalExpenses = records.reduce((s, r) => s + r.expense, 0);
    const netTotal = totalFees - totalExpenses;

    return send(res, 200, {
      kpis: {
        totalFees,
        totalExpenses,
        netTotal
      },
      records
    });
  } catch (error) {
    console.error('[reports] getRevenueReport error:', error);
    return send(res, 500, { error: 'Failed to load revenue report.' });
  }
}

// 8. Consolidated Transaction Report
async function getTransactionReport(req, res, url) {
  const pool = getPool();
  try {
    const fromDate = clean(url.searchParams.get('from'), 10);
    const toDate = clean(url.searchParams.get('to'), 10);
    const category = clean(url.searchParams.get('category'), 20);

    const [feeTxRes, incTxRes, expTxRes] = await Promise.all([
      queryWithLimit(() => pool.query(`
        select id, amount, method, receipt_no as reference, paid_at as tx_date, 'Fee Collection' as category, 'Income' as flow
        from public.fee_payments where reversed_at is null order by paid_at desc limit 200
      `)),
      queryWithLimit(() => pool.query(`
        select id, amount, payment_mode as method, receipt_number as reference, received_date as tx_date, 'Other Income' as category, 'Income' as flow
        from public.income_records order by received_date desc limit 200
      `)),
      queryWithLimit(() => pool.query(`
        select id, amount, payment_mode as method, receipt_number as reference, expense_date as tx_date, 'Expense' as category, 'Expense' as flow
        from public.expenses order by expense_date desc limit 200
      `))
    ]);

    let combined = [
      ...feeTxRes.rows,
      ...incTxRes.rows,
      ...expTxRes.rows
    ];

    if (category) {
      combined = combined.filter(c => c.category.toLowerCase().includes(category.toLowerCase()));
    }

    combined.sort((a, b) => new Date(b.tx_date).getTime() - new Date(a.tx_date).getTime());

    const records = combined.slice(0, 500).map(t => ({
      id: t.id,
      date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t.tx_date)),
      category: t.category,
      flow: t.flow,
      amount: Number(t.amount || 0),
      method: (t.method || 'cash').toUpperCase(),
      reference: t.reference || '—'
    }));

    const totalInflow = records.filter(r => r.flow === 'Income').reduce((s, r) => s + r.amount, 0);
    const totalOutflow = records.filter(r => r.flow === 'Expense').reduce((s, r) => s + r.amount, 0);

    return send(res, 200, {
      kpis: {
        totalTransactions: records.length,
        totalInflow,
        totalOutflow,
        netFlow: totalInflow - totalOutflow
      },
      records
    });
  } catch (error) {
    console.error('[reports] getTransactionReport error:', error);
    return send(res, 500, { error: 'Failed to load transaction report.' });
  }
}

// 9. Communication Log Report
async function getCommunicationReport(req, res) {
  const pool = getPool();
  try {
    const [msgRes, reminderRes] = await Promise.all([
      queryWithLimit(() => pool.query(`
        select id, channel, recipient, status, sent_at, body
        from public.class_messages order by sent_at desc limit 200
      `)),
      queryWithLimit(() => pool.query(`
        select id, student_id, student_fee_id, channel, status, sent_at, details
        from public.reminder_log order by sent_at desc limit 200
      `))
    ]);

    const combined = [
      ...(msgRes.rows || []).map(m => ({
        id: m.id,
        date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(m.sent_at)),
        channel: (m.channel || 'SMS').toUpperCase(),
        recipient: m.recipient || 'Student/Parent',
        content: m.body ? m.body.slice(0, 60) + '...' : 'Message broadcast',
        status: m.status || 'Delivered'
      })),
      ...(reminderRes.rows || []).map(r => ({
        id: r.id,
        date: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.sent_at)),
        channel: (r.channel || 'WhatsApp').toUpperCase(),
        recipient: 'Fee Defaulter',
        content: 'Payment Reminder Notification',
        status: r.status || 'Sent'
      }))
    ];

    return send(res, 200, {
      kpis: {
        totalSent: combined.length,
        delivered: combined.filter(c => c.status.toLowerCase().includes('deliv') || c.status.toLowerCase().includes('sent')).length
      },
      records: combined
    });
  } catch (error) {
    console.error('[reports] getCommunicationReport error:', error);
    return send(res, 500, { error: 'Failed to load communication report.' });
  }
}

// 10. At-Risk Students Report
async function getAtRiskReport(req, res) {
  const pool = getPool();
  try {
    const result = await queryWithLimit(() => pool.query(`
      select
        s.id, s.name, s.admission_number, s.phone, s.email, s.risk,
        b.name as batch_name,
        coalesce(att.present_count, 0)::int as present_count,
        coalesce(att.total_classes, 0)::int as total_classes
      from public.students s
      left join public.batches b on b.id = s.batch_id
      left join (
        select student_id, count(*)::int as total_classes, count(*) filter (where status in ('present','Late','Taken'))::int as present_count
        from public.live_class_joins group by student_id
      ) att on att.student_id = s.id
      where lower(coalesce(s.status, 'active')) = 'active'
        and (s.risk in ('High', 'Medium') or (att.total_classes > 0 and (att.present_count * 100 / att.total_classes) < 75))
      order by s.risk desc, s.name
      limit 500
    `));

    const records = result.rows.map(r => {
      const attRate = r.total_classes > 0 ? Math.round((r.present_count * 100) / r.total_classes) : 0;
      return {
        id: r.id,
        name: r.name,
        admissionNumber: r.admission_number || '—',
        phone: r.phone || '—',
        batch: r.batch_name || '—',
        riskLevel: r.risk || (attRate < 60 ? 'High' : 'Medium'),
        attendanceRate: `${attRate}%`,
        classesAttended: `${r.present_count}/${r.total_classes}`
      };
    });

    return send(res, 200, {
      kpis: {
        totalAtRisk: records.length,
        highRisk: records.filter(r => r.riskLevel === 'High').length
      },
      records
    });
  } catch (error) {
    console.error('[reports] getAtRiskReport error:', error);
    return send(res, 500, { error: 'Failed to load at-risk students report.' });
  }
}

// 11. Deleted Students Report
async function getDeletedStudentsReport(req, res) {
  const pool = getPool();
  try {
    const result = await queryWithLimit(() => pool.query(`
      select
        s.id, s.name, s.admission_number, s.phone, s.email, s.status,
        b.name as batch_name, s.updated_at
      from public.students s
      left join public.batches b on b.id = s.batch_id
      where lower(coalesce(s.status, '')) in ('deleted', 'archived', 'trash')
      order by s.updated_at desc
      limit 500
    `));

    const records = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      admissionNumber: r.admission_number || '—',
      phone: r.phone || '—',
      email: r.email || '—',
      batch: r.batch_name || '—',
      deletedAt: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.updated_at))
    }));

    return send(res, 200, {
      kpis: {
        deletedCount: records.length
      },
      records
    });
  } catch (error) {
    console.error('[reports] getDeletedStudentsReport error:', error);
    return send(res, 500, { error: 'Failed to load deleted students report.' });
  }
}

// 12. Direct CSV Export: Students CSV
async function exportStudentsCsv(req, res) {
  const pool = getPool();
  try {
    const result = await queryWithLimit(() => pool.query(`
      select
        s.admission_number, s.name, s.email, s.phone,
        b.name as batch_name, c.name as course_name, s.status, s.created_at
      from public.students s
      left join public.batches b on b.id = s.batch_id
      left join public.courses c on c.id = s.course_id
      order by s.name
      limit 10000
    `));

    const headers = ['Admission Number', 'Student Name', 'Email', 'Phone', 'Batch', 'Course', 'Status', 'Enrollment Date'];
    const rows = [headers];
    for (const r of result.rows) {
      rows.push([
        r.admission_number || '',
        r.name || '',
        r.email || '',
        r.phone || '',
        r.batch_name || '',
        r.course_name || '',
        r.status || 'Active',
        r.created_at ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.created_at)) : ''
      ]);
    }
    return csvResponse(res, rows, `students-export-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    console.error('[reports] exportStudentsCsv error:', error);
    return send(res, 500, { error: 'Failed to export students CSV.' });
  }
}

// 13. Direct CSV Export: Fees CSV
async function exportFeesCsv(req, res) {
  const pool = getPool();
  try {
    const result = await queryWithLimit(() => pool.query(`
      select
        fp.receipt_no, s.name as student_name, s.admission_number, b.name as batch_name,
        sf.title as fee_title, fp.amount, coalesce(fp.fine_amount, 0)::numeric as fine_amount,
        fp.method, fp.paid_at, coalesce(acc.name, fp.received_by, 'Admin') as recorded_by
      from public.fee_payments fp
      left join public.student_fees sf on sf.id = fp.student_fee_id
      left join public.students s on s.id = fp.student_key or s.student_key = fp.student_key
      left join public.batches b on b.id = sf.batch_id or b.id = s.batch_id
      left join public.accounts acc on acc.email = fp.received_by or acc.id = fp.received_by
      where fp.reversed_at is null
      order by fp.paid_at desc
      limit 10000
    `));

    const headers = ['Receipt No', 'Student Name', 'Admission No', 'Batch', 'Fee Title', 'Principal Amount', 'Fine', 'Payment Method', 'Payment Date', 'Recorded By'];
    const rows = [headers];
    for (const r of result.rows) {
      rows.push([
        r.receipt_no || '',
        r.student_name || '',
        r.admission_number || '',
        r.batch_name || '',
        r.fee_title || '',
        Number(r.amount || 0).toFixed(2),
        Number(r.fine_amount || 0).toFixed(2),
        r.method ? r.method.toUpperCase() : 'CASH',
        r.paid_at ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(r.paid_at)) : '',
        r.recorded_by || 'Admin'
      ]);
    }
    return csvResponse(res, rows, `fees-collection-export-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    console.error('[reports] exportFeesCsv error:', error);
    return send(res, 500, { error: 'Failed to export fees CSV.' });
  }
}

// 14. Direct CSV Export: Attendance CSV
async function exportAttendanceCsv(req, res) {
  const pool = getPool();
  try {
    const result = await queryWithLimit(() => pool.query(`
      select
        (lc.scheduled_at at time zone 'Asia/Kolkata')::date as attendance_date,
        coalesce(s.name, 'Student') as student_name,
        s.admission_number,
        coalesce(b.name, 'All Batches') as batch_name,
        coalesce(sub.name, lc.title, 'Class') as subject_name,
        j.status as attendance_status,
        j.joined_at,
        coalesce(j.duration_minutes, lc.duration_minutes, 60) as duration_minutes
      from public.live_classes lc
      left join public.batches b on b.id = lc.batch_id
      left join public.subjects sub on sub.id = lc.subject_id
      join public.live_class_joins j on j.class_id = lc.id
      left join public.students s on s.id = j.student_id
      order by j.joined_at desc
      limit 10000
    `));

    const headers = ['Attendance Date', 'Student Name', 'Admission No', 'Batch', 'Subject', 'Status', 'Joined Time', 'Duration (Min)'];
    const rows = [headers];
    for (const r of result.rows) {
      rows.push([
        r.attendance_date ? String(r.attendance_date).slice(0, 10) : '',
        r.student_name || '',
        r.admission_number || '',
        r.batch_name || '',
        r.subject_name || '',
        r.attendance_status || 'Present',
        r.joined_at ? new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(r.joined_at)) : '',
        Number(r.duration_minutes || 0)
      ]);
    }
    return csvResponse(res, rows, `attendance-export-${new Date().toISOString().slice(0, 10)}.csv`);
  } catch (error) {
    console.error('[reports] exportAttendanceCsv error:', error);
    return send(res, 500, { error: 'Failed to export attendance CSV.' });
  }
}

// Route Dispatcher
async function handleReportsRoute(req, res, url) {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/admin/reports')) return null;

  let auth;
  try {
    auth = await authenticate(req);
  } catch (error) {
    return send(res, 503, { error: 'Administrator session could not be verified.' });
  }
  if (auth.error) return send(res, auth.status, { error: auth.error });

  // Direct CSV Export endpoints
  if (req.method === 'GET' && pathname === '/api/admin/reports/export/students') return exportStudentsCsv(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/export/fees') return exportFeesCsv(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/export/attendance') return exportAttendanceCsv(req, res);

  // Top Stats
  if (req.method === 'GET' && pathname === '/api/admin/reports/stats') return getReportStats(req, res);

  // Report endpoints
  if (req.method === 'GET' && pathname === '/api/admin/reports/fees') return getFeeCollectionReport(req, res, url);
  if (req.method === 'GET' && pathname === '/api/admin/reports/fee-defaulters') return getFeeDefaultersReport(req, res, url);
  if (req.method === 'GET' && pathname === '/api/admin/reports/student-subjects') return getStudentSubjectsReport(req, res, url);
  if (req.method === 'GET' && pathname === '/api/admin/reports/enrollment') return getEnrollmentReport(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/dropouts') return getDropoutReport(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/revenue') return getRevenueReport(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/transactions') return getTransactionReport(req, res, url);
  if (req.method === 'GET' && pathname === '/api/admin/reports/communication') return getCommunicationReport(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/at-risk') return getAtRiskReport(req, res);
  if (req.method === 'GET' && pathname === '/api/admin/reports/deleted-students') return getDeletedStudentsReport(req, res);

  return send(res, 404, { error: 'Report endpoint not found.' });
}

module.exports = { handleReportsRoute };

