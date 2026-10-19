(() => {
  "use strict";

  const root = document.getElementById("app");
  const dialog = document.getElementById("action-dialog");
  const dialogBody = document.getElementById("dialog-content");
  const toastRegion = document.getElementById("toast-region");
  const STORAGE_KEY = "cs-admin-demo-v1";
  const today = "2026-10-19";
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const seed = {
    version: 1,
    academicYears: [{ id: "year-2026", name: "2026–27", startDate: "2026-04-01", endDate: "2027-03-31", status: "Active" }],
    courses: [{ id: "course-jee", name: "JEE Main Preparation", duration: "2 years", description: "JEE coaching program", status: "Active" }],
    staff: [{ id: "staff-anil", name: "Anil Kumar", email: "", phone: "", role: "Physics Teacher", staffType: "Teacher", employeeId: "EMP-001", employmentType: "Full-Time", status: "Active", salary: "" }],
    batches: [{ id: "batch-jee-a", name: "JEE 2027 · A", courseId: "course-jee", teacherId: "staff-anil", academicYearId: "year-2026", schedule: "Mon / Wed / Fri", status: "Active" }],
    students: [{ id: "student-sunil", name: "Sunil Kumar", email: "", phone: "", dateOfBirth: "", gender: "", address: "", parentName: "", parentPhone: "", parentEmail: "", relation: "Parent", courseId: "course-jee", batchId: "batch-jee-a", academicYearId: "year-2026", admissionDate: today, roll: "CS-1001", attendance: 94, status: "Active", photoName: "" }],
    fees: [{ id: "fee-sunil-2026", studentId: "student-sunil", title: "Tuition Fee", total: 60000, installments: 12, dueDate: "2026-11-01", createdAt: today }],
    payments: [{ id: "payment-demo-1", feeId: "fee-sunil-2026", studentId: "student-sunil", amount: 5000, method: "Cash", date: today, receiptNo: "CS-R-0001", note: "Instalment 1/12" }],
    leads: [], sequences: [], liveClasses: [], ptmSessions: [], communications: [], messages: [],
    testSeries: [], exams: [], questions: [], homework: [], attendance: []
  };
  let data = loadStore();
  let route = readRoute();
  let photoPreview = "";
  let selectedReport = "";
  let selectedThread = "";
  let liveClassPlatform = "jitsi";
  let liveClassFilter = "all";
  let enrollmentPeriod = "Monthly";
  let photoData = "";
  let staffPhotoData = "";
  let staffPendingAssignments = [];
  let cameraStream = null;
  let admissionsAdmin = { applications: [], loaded: false, loading: false, authenticated: false, error: "", publicConfig: null, page: 1, filters: { term: "", status: "", batch: "" } };
  let admissionAdminToken = "";
  let admissionPollTimer = null;

  function loadStore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return clone(seed);
      const parsed = JSON.parse(saved);
      const keys = Object.keys(seed);
      if (!parsed || parsed.version !== 1 || keys.some((key) => !Array.isArray(parsed[key]) && key !== "version")) return clone(seed);
      parsed.staff = parsed.staff.map((item, index) => {
        const employeeId = String(item.employeeId || `EMP-${String(index + 1).padStart(3, "0")}`);
        const legacyType = String(item.staffType || item.role || "Teacher").trim();
        const staffType = ["Teacher", "Admin", "Accountant", "Counselor", "Receptionist", "Librarian", "Other"].find((type) => new RegExp(`${type}$`, "i").test(legacyType)) || legacyType || "Teacher";
        return { countryCode: "91", photo: "", employeeId, staffType, branchIds: [], salary: "", monthlySalary: item.salary || "", pfPercent: 12, tdsPercent: 0, bankAccount: "", bankName: "", ifsc: "", pan: "", qualification: "", specialization: "", experienceYears: "", joiningDate: "", subjectAssignments: [], status: "Active", ...item, employeeId, staffType, branchIds: Array.isArray(item.branchIds) ? item.branchIds : [], subjectAssignments: Array.isArray(item.subjectAssignments) ? item.subjectAssignments : [], createdAt: item.createdAt || today };
      });
      return parsed;
    } catch {
      return clone(seed);
    }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; }
    catch { return false; }
  }
  function commit(label, mutate) {
    const before = clone(data);
    mutate(data);
    if (!persist()) {
      data = before;
      toast("Could not save this change in browser storage. Your previous records were kept.", true);
      render();
      return false;
    }
    toast(label);
    render();
    return true;
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }
  function money(value) { return `₹${Number(value || 0).toLocaleString("en-IN")}`; }
  function dateLabel(value) { if (!value) return "—"; const date = new Date(`${value}T00:00:00`); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date); }
  function safeMeetingUrl(value) { try { const url = new URL(String(value || "")); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } }
  function course(id) { return data.courses.find((item) => item.id === id); }
  function batch(id) { return data.batches.find((item) => item.id === id); }
  function student(id) { return data.students.find((item) => item.id === id); }
  function staff(id) { return data.staff.find((item) => item.id === id); }
  function fee(id) { return data.fees.find((item) => item.id === id); }
  function paid(feeId) { return data.payments.filter((payment) => payment.feeId === feeId).reduce((total, payment) => total + Number(payment.amount), 0); }
  function balance(feeId) { const item = fee(feeId); return item ? Math.max(0, Number(item.total) - paid(feeId)) : 0; }
  function studentFees(studentId) { return data.fees.filter((item) => item.studentId === studentId); }
  function attendanceRate(studentId) { const entries = data.attendance.flatMap((day) => day.records.filter((record) => record.studentId === studentId)); if (!entries.length) return Number(student(studentId)?.attendance || 0); const counted = entries.filter((record) => record.status !== "E"); if (!counted.length) return 0; return Math.round(counted.filter((record) => record.status === "P" || record.status === "L").length / counted.length * 100); }
  function receiptFor(paymentId) { return data.payments.find((item) => item.id === paymentId); }
  function toast(message, error = false) {
    if (!toastRegion) return;
    const item = document.createElement("div"); item.className = `toast${error ? " error" : ""}`; item.textContent = message; toastRegion.append(item);
    window.setTimeout(() => item.remove(), 3600);
  }
  function readRoute() { return ((location.hash.replace(/^#/, "").split("?")[0]) || "dashboard").replace(/\/$/, ""); }
  function go(next) { if (route === next) { render(); return; } location.hash = next; }
  function logo() { return `<div class="portal-logo"><img src="assets/mainlogo.png" alt="My JEE Mentor"></div>`; }

  const navGroups = [
    ["Overview", [
      { id: "dashboard", label: "Dashboard", icon: "dashboard" },
      { id: "academic-years", label: "Academic Years", icon: "calendar-grid" },
      { id: "reports", label: "Reports", icon: "chart-bars" }
    ]],
    ["People", [
      { id: "students", label: "Students", icon: "id-badge" },
      { id: "staff", label: "Staff", icon: "staff-board" },
      { id: "admissions", label: "Online Admissions", icon: "user-plus" }
    ]],
    ["Curriculum", [
      { id: "courses", label: "Courses", icon: "graduation-cap", children: [
        { id: "subjects", label: "Subjects", icon: "book-open" },
        { id: "topics", label: "Topics", icon: "tag" }
      ] },
      { id: "batches", label: "Batches", icon: "layers" },
      { id: "question-bank", label: "Question Bank", icon: "archive" }
    ]],
    ["Academics", [
      { id: "timetable", label: "Timetable", icon: "calendar-dots" },
      { id: "attendance", label: "Attendance", icon: "clipboard-check" },
      { id: "homework", label: "Homework", icon: "pencil" },
      { id: "doubts", label: "Doubts", icon: "chat-dots", placeholder: true },
      { id: "leave-holidays", label: "Leave & Holidays", icon: "calendar-x", placeholder: true }
    ]],
    ["Exams & Results", [
      { id: "exams", label: "Online Exams", icon: "list-notebook" },
      { id: "offline-exams", label: "Offline Exams", icon: "edit-square" },
      { id: "test-series", label: "Test Series", icon: "stack" },
      { id: "results", label: "Report Cards", icon: "report-chart" },
      { id: "certificates", label: "Certificates", icon: "badge-check" },
      { id: "id-cards", label: "ID Cards", icon: "id-card" },
      { id: "proctoring", label: "Proctoring", icon: "video", placeholder: true }
    ]],
    ["Content & Media", [
      { id: "download-center", label: "Download Center", icon: "cloud-download", placeholder: true, children: [
        { id: "materials", label: "Learning Materials", icon: "archive" }
      ] },
      { id: "video-lectures", label: "Video Lectures", icon: "video" },
      { id: "live-classes", label: "Live Classes", icon: "broadcast" }
    ]],
    ["Finance", [
      { id: "fees", label: "Fee Collection", icon: "banknote-coin", children: [
        { id: "fee-structures", label: "Fee Structures", icon: "table" },
        { id: "discounts", label: "Discounts & Coupons", icon: "tag" },
        { id: "late-fee-rules", label: "Late Fee Rules", icon: "clock", placeholder: true },
        { id: "payment-reminders", label: "Payment Reminders", icon: "bell" },
        { id: "deletion-audit-log", label: "Deletion Audit Log", icon: "shield-check", placeholder: true },
        { id: "accounting-export", label: "Accounting Export", icon: "document-grid", placeholder: true },
        { id: "billing", label: "Smart Billing Hub", icon: "calculator" },
        { id: "payments", label: "Payment History", icon: "archive" }
      ] },
      { id: "expenses", label: "Expenses", icon: "calculator", children: [
        { id: "expense-heads", label: "Expense Heads", icon: "tag-outline", placeholder: true }
      ] },
      { id: "income", label: "Income", icon: "trend", placeholder: true, children: [
        { id: "income-heads", label: "Income Heads", icon: "tag-outline", placeholder: true }
      ] }
    ]],
    ["HR & Staff", [
      { id: "payroll", label: "Payroll", icon: "banknote", children: [
        { id: "payslips", label: "Payslips", icon: "document" }
      ] },
      { id: "staff-attendance", label: "Staff Attendance", icon: "person-check" },
      { id: "biometric", label: "Biometric", icon: "fingerprint", placeholder: true, children: [
        { id: "work-shifts", label: "Work Shifts", icon: "clock", placeholder: true }
      ] },
      { id: "faculty-performance", label: "Faculty Performance", icon: "trend", placeholder: true }
    ]],
    ["CRM & Growth", [
      { id: "leads", label: "Lead CRM", icon: "funnel", children: [
        { id: "lead-nurturing", label: "Lead Nurturing", icon: "robot" },
        { id: "proposals", label: "Proposals", icon: "document", placeholder: true },
        { id: "meta-leads", label: "Meta Lead Ads", icon: "facebook" }
      ] },
      { id: "refer-earn", label: "Refer & Earn", icon: "gift", placeholder: true },
      { id: "alumni-wall", label: "Alumni Wall", icon: "graduation-cap", placeholder: true }
    ]],
    ["Communication", [
      { id: "broadcast", label: "Bulk Messaging", icon: "megaphone", children: [
        { id: "messages", label: "Inbox", icon: "chat-dots" },
        { id: "sms-whatsapp-hub", label: "SMS / WhatsApp Hub", icon: "lightning", placeholder: true },
        { id: "email-campaigns", label: "Email Campaigns", icon: "envelope", placeholder: true },
        { id: "custom-forms", label: "Custom Forms", icon: "checklist", placeholder: true }
      ] },
      { id: "custom-columns", label: "Custom Columns", icon: "columns", placeholder: true },
      { id: "ptm", label: "PTM Meetings", icon: "people" }
    ]],
    ["Operations", [
      { id: "library", label: "Library", icon: "book-open", children: [
        { id: "library-fines", label: "Library Fines", icon: "rupee", placeholder: true }
      ] },
      { id: "transport", label: "Transport", icon: "bus", placeholder: true },
      { id: "hostel", label: "Hostel", icon: "home", placeholder: true },
      { id: "inventory", label: "Inventory", icon: "cubes", placeholder: true },
      { id: "canteen", label: "Canteen", icon: "coffee", placeholder: true },
      { id: "gamification", label: "Gamification", icon: "trophy", placeholder: true }
    ]],
    ["Settings", [
      { id: "settings", label: "General Settings", icon: "gear" },
      { id: "branches", label: "Branches", icon: "building", placeholder: true },
      { id: "roles-permissions", label: "Roles & Permissions", icon: "shield-keyhole", placeholder: true },
      { id: "mobile-app-branding", label: "Mobile App Branding", icon: "phone", placeholder: true },
      { id: "integrations", label: "Integrations", icon: "puzzle", placeholder: true },
      { id: "ai-credits", label: "AI Credits", icon: "chip", placeholder: true }
    ]]
  ];
  const NAV_ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    "calendar-grid": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4m10-4v4M3 9h18M7 13h.01M11 13h.01M15 13h.01M7 17h.01M11 17h.01M15 17h.01"/>',
    "chart-bars": '<path d="M4 20V11h4v9zm6 0V5h4v15zm6 0V8h4v12z"/>',
    "id-badge": '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="9" r="2.5"/><path d="M8 17c.8-2 2.1-3 4-3s3.2 1 4 3"/>',
    "staff-board": '<rect x="3" y="4" width="18" height="15" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M7.5 16c.8-1.8 2.3-2.7 4.5-2.7s3.7.9 4.5 2.7M12 19v3M8 22h8"/>',
    "user-plus": '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1m4-11v6m-3-3h6"/>',
    "graduation-cap": '<path d="m2 9 10-5 10 5-10 5zM6 11v5c3.7 2.7 8.3 2.7 12 0v-5m4-2v7"/>',
    "book-open": '<path d="M3 5c3-1.5 6-.8 9 1.5V21c-3-2.3-6-3-9-1.5zm18 0c-3-1.5-6-.8-9 1.5V21c3-2.3 6-3 9-1.5z"/>',
    tag: '<path d="M3 12V4h8l10 10-7 7L3 12z"/><circle cx="8" cy="8" r="1"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    archive: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M3 4h18v4H3zm6 8h6"/>',
    "calendar-dots": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4m10-4v4M3 9h18"/><circle cx="8" cy="13" r=".7"/><circle cx="12" cy="13" r=".7"/><circle cx="16" cy="13" r=".7"/><circle cx="8" cy="17" r=".7"/><circle cx="12" cy="17" r=".7"/>',
    "clipboard-check": '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4V2h6v2M8 12l2.5 2.5L16 9m-8 8h8"/>',
    pencil: '<path d="m4 16-.8 4.8L8 20l11-11-4-4L4 16zM13.5 6.5l4 4"/>',
    "chat-dots": '<path d="M4 5h16v12H9l-5 4z"/><circle cx="9" cy="11" r=".8"/><circle cx="12" cy="11" r=".8"/><circle cx="15" cy="11" r=".8"/>',
    "calendar-x": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4m10-4v4M3 9h18m6 5 5 5m0-5-5 5"/>',
    "list-notebook": '<rect x="5" y="3" width="16" height="18" rx="2"/><path d="M9 7h8M9 11h8M9 15h5M3 7h.01M3 11h.01M3 15h.01"/>',
    "edit-square": '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 16 1-4L17 4l3 3-8 8-4 1zm8-10 3 3"/>',
    stack: '<path d="m12 3 9 5-9 5-9-5 9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5"/>',
    "report-chart": '<path d="M5 3h10l4 4v14H5zM15 3v5h5M8 17v-4m4 4V9m4 8v-6"/>',
    "badge-check": '<path d="m12 2 2.3 1.7 2.8-.1.9 2.7 2.3 1.7-.9 2.7.9 2.7-2.3 1.7-.9 2.7-2.8-.1L12 21l-2.3-1.7-2.8.1-.9-2.7-2.3-1.7.9-2.7-.9-2.7L6 7.9l.9-2.7 2.8.1L12 2z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
    "id-card": '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2.5"/><path d="M5.5 17c.6-1.8 1.8-2.7 3.5-2.7s2.9.9 3.5 2.7M15 9h3m-3 4h3m-3 4h2"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
    "cloud-download": '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8h-2m-5-7v9m-3-3 3 3 3-3"/>',
    broadcast: '<path d="M5 9a10 10 0 0 0 0 6m14-6a10 10 0 0 1 0 6M8 10.5a5 5 0 0 0 0 3m8-3a5 5 0 0 1 0 3"/><circle cx="12" cy="12" r="1.5"/>',
    "banknote-coin": '<rect x="2.5" y="5" width="15" height="12" rx="2"/><circle cx="10" cy="11" r="2.5"/><path d="M5 8h.01M15 14h.01"/><circle cx="18" cy="16" r="4"/><path d="M18 14.5v3m-1-2.5h2"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10m6-10v10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4"/>',
    "shield-check": '<path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="m8.5 12 2.3 2.3 4.7-4.7"/>',
    "document-grid": '<path d="M5 3h10l4 4v14H5zM15 3v5h5"/><path d="M8 12h3v3H8zm5 0h3v3h-3zm-5 5h3v2H8zm5 0h3v2h-3z"/>',
    calculator: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M8 6h8v4H8zm0 8h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    "tag-outline": '<path d="M3 12V4h8l10 10-7 7L3 12z"/><circle cx="8" cy="8" r="1.2"/>',
    trend: '<path d="M3 19V5m0 14h18M7 15l4-4 3 2 6-7m-5 0h5v5"/>',
    banknote: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h.01M18 15h.01"/>',
    document: '<path d="M5 3h10l4 4v14H5zM15 3v5h5M8 12h8M8 16h8"/>',
    "person-check": '<circle cx="9" cy="7" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1m1-7 2 2 4-4"/>',
    fingerprint: '<path d="M12 11v3m-5-2a5 5 0 0 1 10 0v3m-13-2a8 8 0 0 1 16 0v2M9 17a10 10 0 0 1-1 4m7-4c.2 2 .6 3.3 1.5 4.5M5 16c0 2-.4 3.5-1 5m15-5c0 1.3.3 2.6 1 4"/>',
    funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8z"/>',
    robot: '<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4m-4 5h.01M16 12h.01M8 16h8M2 11v5m20-5v5"/><circle cx="12" cy="3" r="1"/>',
    facebook: '<circle cx="12" cy="12" r="9"/><path d="M13.5 20v-7h2.4l.4-3h-2.8V8.2c0-.9.3-1.5 1.5-1.5h1.5V4.1c-.3 0-1.2-.1-2.3-.1-2.4 0-4 1.4-4 4.1V10H7.5v3h2.7v7"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M2 6h20v4H2zm10 0v15m0-15H8.5C5 6 5 2 8 2c2 0 4 4 4 4zm0 0h3.5c3.5 0 3.5-4 0.5-4-2 0-4 4-4 4z"/>',
    megaphone: '<path d="M3 10v4h4l10 5V5L7 10zm4 4 2 6h4l-2-4m6-8h3v8h-3"/>',
    lightning: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
    envelope: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    checklist: '<rect x="5" y="3" width="16" height="18" rx="2"/><path d="m8 8 1 1 2-2m2 1h4m-9 5 1 1 2-2m2 1h4m-9 4h1m2 0h4M3 7h.01M3 13h.01M3 19h.01"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m6-18v18"/>',
    people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20v-1a6 6 0 0 1 12 0v1m1-6a5 5 0 0 1 5 5v1h-3"/>',
    rupee: '<path d="M6 4h12M6 8h12m-11 0 10 12m-11 0 6-7c4-5 1-9-4-9"/>',
    bus: '<rect x="3" y="4" width="18" height="15" rx="3"/><path d="M3 11h18M7 7h3m4 0h3m-11 8h.01M16 15h.01M7 19v2m10-2v2"/>',
    home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/>',
    cubes: '<path d="m12 3 4 2.3v4.5L12 12l-4-2.2V5.3zM4 12l4 2.3v4.5L4 21l-4-2.2v-4.5zm16 0 4 2.3v4.5L20 21l-4-2.2v-4.5zM8 7l4 2.4L16 7m-8 7.3 4 2.2 4-2.2m-8 4.5 4 2 4-2"/>',
    coffee: '<path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zm13 2h2a2 2 0 1 1 0 4h-2M8 3c-2 2 2 2 0 4m5-4c-2 2 2 2 0 4"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 0v5m-4 3h8m-6-3h4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.8 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.8-1l-1.7.6-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.8-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.8 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2z"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2m-5 6v-3h2v3"/>',
    "shield-keyhole": '<path d="M12 3 20 6v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><circle cx="12" cy="11" r="2"/><path d="M12 13v3"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
    puzzle: '<path d="M4 4h5a3 3 0 1 1 6 0h5v5a3 3 0 1 0 0 6v5h-5a3 3 0 1 1-6 0H4v-5a3 3 0 1 0 0-6z"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4"/>',
    "exam-plus": '<rect x="5" y="3" width="15" height="19" rx="2"/><path d="M9 2v3m7-3v3M2 7h2m-2 4h2m-2 4h2m8-5h6m-3-3v6"/>',
    "crm-list": '<circle cx="7" cy="7" r="3"/><path d="M2.5 20v-1a4.5 4.5 0 0 1 9 0v1M15 6h7m-7 5h7m-7 5h7m-7 4h5"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3m-13 5h18m-11 0v2h4v-2"/>',
    "cloud-upload": '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8h-2m-5 2V11m-3 3 3-3 3 3"/>'
  };
  function navIcon(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${NAV_ICONS[name] || '<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>'}</svg>`; }
  const routeMetaById = new Map();
  navGroups.forEach(([group, items]) => items.forEach((item) => {
    routeMetaById.set(item.id, { ...item, group });
    (item.children || []).forEach((child) => routeMetaById.set(child.id, { ...child, group }));
  }));
  const pageTitles = Object.fromEntries([...routeMetaById].map(([id, item]) => [id, item.label]));
  const collapsedNavGroups = new Set();
  try {
    JSON.parse(sessionStorage.getItem("cs-admin-collapsed-nav-groups") || "[]").forEach((group) => collapsedNavGroups.add(group));
  } catch { /* Storage can be unavailable in private or restricted contexts. */ }
  function shell() {
    const active = route.split("/")[0];
    const isStudents = route === "students" || route === "students/new";
    root.innerHTML = `${isStudents ? "" : `<div class="dev-ribbon">LOCAL DEMO · BROWSER DATA</div>`}<div class="workspace${isStudents ? " students-layout" : ""}">
      <aside class="sidebar"><div class="side-brand">${logo()}</div><label class="side-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/></svg><input id="menu-search" type="search" placeholder="Search menu..." aria-label="Search menu" /></label><nav class="side-nav" aria-label="Admin menu">${navGroups.map(([group, items]) => renderNavGroup(group, items, active)).join("")}<button class="side-profile" data-route="profile"><span class="profile-avatar">${isStudents ? "DE" : "AD"}</span><span><b>${isStudents ? "Deepak" : "Ananya Sharma"}</b><small>${isStudents ? "Institute Admin" : "Institute Admin ? Local demo"}</small></span><span class="profile-caret">?</span></button></nav></aside><div class="side-backdrop" data-close-sidebar></div>
      <header class="topbar"><button class="top-toggle" aria-label="Toggle navigation" data-toggle-sidebar>☰</button><div class="top-title">${isStudents ? "Academics / Students" : esc(titleForRoute())}</div>${isStudents ? `<span class="student-plan-notice">⚠ Plan expires in 6 days</span>` : `<span class="admin-plan-notice">LOCAL PREVIEW</span>`}<label class="top-search"><span>⌕</span><input id="global-search" type="search" placeholder="Search students, leads, fees…" aria-label="Search visible records" /></label><button class="top-icon-btn" data-action="notifications" aria-label="Notifications">♧</button><button class="top-icon-btn" data-action="settings" aria-label="Settings">⚙</button><button class="top-icon-btn" data-action="logout" aria-label="Log out">⇥</button></header>
      <main class="main-area" id="main-area">${renderPage()}</main><footer class="page-footer"><span>${isStudents ? "© 2026 JEE Mentor" : "© 2026 JEE Mentor · Local prototype"}</span><span>${isStudents ? "My JEE Mentor v3.0" : "My JEE Mentor inspired · No service connections"}</span></footer></div>`;
    bindShell();
    if (route === "admissions") loadAdmissionsAdmin();
  }
  function titleForRoute() { const id = route.split("/")[0]; return pageTitles[id] || (id === "student" ? "Student Profile" : id === "fee" ? "Assign Fee" : id === "profile" ? "My Profile" : id === "staff-create" ? "Staff / Add New Staff" : id === "staff-edit" ? "Staff / Edit Staff" : "Dashboard"); }
  function isNavItemActive(item, active) { return active === item.id || (item.id === "students" && active === "student") || (item.id === "fees" && active === "fee"); }
  function renderNavItem(item, active, subItem = false) {
    const isActive = isNavItemActive(item, active);
    return `<a class="nav-item${subItem ? " nav-sub-item" : ""}${isActive ? " active" : ""}" href="#${esc(item.id)}" data-route="${esc(item.id)}" data-label="${esc(item.label.toLowerCase())}" data-icon="${esc(item.icon)}"${isActive ? ' aria-current="page"' : ""}><span class="nav-icon" data-icon="${esc(item.icon)}" aria-hidden="true">${navIcon(item.icon)}</span><span>${esc(item.label)}</span></a>`;
  }
  function renderNavGroup(group, items, active) {
    const groupIsActive = items.some((item) => isNavItemActive(item, active) || (item.children || []).some((child) => isNavItemActive(child, active)));
    const isCollapsed = !groupIsActive && collapsedNavGroups.has(group);
    const contents = items.map((item) => `<div class="nav-entry">${renderNavItem(item, active)}${item.children?.length ? `<div class="nav-subitems">${item.children.map((child) => renderNavItem(child, active, true)).join("")}</div>` : ""}</div>`).join("");
    return `<section class="nav-group${isCollapsed ? " collapsed" : ""}" data-nav-group="${esc(group)}" data-active="${groupIsActive}"><button class="nav-group-title" type="button" data-group-toggle="${esc(group)}" aria-expanded="${!isCollapsed}"><span>${esc(group)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button><div class="nav-group-items"${isCollapsed ? " hidden" : ""}>${contents}</div></section>`;
  }
  function bindShell() {
    root.querySelectorAll("[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); go(link.dataset.route); }));
    root.querySelectorAll("[data-group-toggle]").forEach((button) => button.addEventListener("click", () => {
      const group = button.dataset.groupToggle;
      const section = button.closest(".nav-group");
      if (!section || section.dataset.active === "true") return;
      const isCollapsed = !section.classList.contains("collapsed");
      section.classList.toggle("collapsed", isCollapsed);
      section.querySelector(".nav-group-items").hidden = isCollapsed;
      button.setAttribute("aria-expanded", String(!isCollapsed));
      if (isCollapsed) collapsedNavGroups.add(group); else collapsedNavGroups.delete(group);
      try { sessionStorage.setItem("cs-admin-collapsed-nav-groups", JSON.stringify([...collapsedNavGroups])); } catch { /* Keep the menu usable if storage is unavailable. */ }
    }));
    root.querySelector("[data-toggle-sidebar]")?.addEventListener("click", () => { root.querySelector(".sidebar")?.classList.toggle("open"); root.querySelector(".side-backdrop")?.classList.toggle("open"); });
    root.querySelector("[data-close-sidebar]")?.addEventListener("click", () => { root.querySelector(".sidebar")?.classList.remove("open"); root.querySelector(".side-backdrop")?.classList.remove("open"); });
    root.querySelector("#menu-search")?.addEventListener("input", (event) => {
      const value = event.target.value.trim().toLowerCase();
      const filtering = value.length > 0;
      root.querySelectorAll(".nav-group").forEach((group) => {
        let groupMatches = false;
        group.querySelectorAll(":scope > .nav-group-items > .nav-entry").forEach((entry) => {
          const parent = entry.querySelector(":scope > .nav-item");
          const children = [...entry.querySelectorAll(":scope > .nav-subitems > .nav-item")];
          const parentMatches = !filtering || parent.dataset.label.includes(value);
          const childMatches = children.some((child) => child.dataset.label.includes(value));
          parent.hidden = filtering && !parentMatches && !childMatches;
          children.forEach((child) => { child.hidden = filtering && !child.dataset.label.includes(value); });
          groupMatches ||= parentMatches || childMatches;
        });
        group.hidden = filtering && !groupMatches;
        const content = group.querySelector(":scope > .nav-group-items");
        if (filtering) content.hidden = false;
        else content.hidden = group.classList.contains("collapsed") && group.dataset.active !== "true";
      });
    });
    root.querySelector("#global-search")?.addEventListener("input", (event) => filterRows(event.target.value));
    root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
    root.querySelectorAll("[data-open-form]").forEach((button) => button.addEventListener("click", () => go(button.dataset.openForm)));
    root.querySelectorAll("[data-dialog-action]").forEach((button) => button.addEventListener("click", () => handleDialogAction(button.dataset.dialogAction, button.dataset.id || "")));
    root.querySelectorAll("[data-export-report]").forEach((button) => button.addEventListener("click", () => exportReportCsv(button.dataset.exportReport)));
    root.querySelectorAll("[data-adm-copy]").forEach((button) => button.addEventListener("click", copyAdmissionLink));
    root.querySelector("[data-adm-search]")?.addEventListener("input", filterAdmissionRows);
    root.querySelectorAll("[data-adm-status], [data-adm-batch]").forEach((control) => control.addEventListener("change", filterAdmissionRows));
    root.querySelector("[data-adm-filter]")?.addEventListener("click", filterAdmissionRows);
    root.querySelector("[data-adm-clear]")?.addEventListener("click", () => { admissionsAdmin.filters = { term: "", status: "", batch: "" }; admissionsAdmin.page = 1; shell(); });
    root.querySelectorAll("[data-adm-page]").forEach((button) => button.addEventListener("click", () => { admissionsAdmin.page += Number(button.dataset.admPage); shell(); }));
    root.querySelectorAll("[data-adm-view]").forEach((button) => button.addEventListener("click", () => showAdmissionDetails(button.dataset.admView)));
    root.querySelector("[data-adm-retry]")?.addEventListener("click", () => { admissionsAdmin.loaded = false; loadAdmissionsAdmin(); });
    root.querySelector("[data-adm-refresh]")?.addEventListener("click", refreshAdmissionsAdmin);
    root.querySelector("[data-adm-toggle]")?.addEventListener("click", toggleAdmissionState);
    root.querySelector("#table-search")?.addEventListener("input", (event) => filterRows(event.target.value));
    root.querySelector("#student-course")?.addEventListener("change", updateBatchOptions);
    root.querySelector("#student-photo")?.addEventListener("change", previewPhoto);
    root.querySelector("[data-student-regenerate]")?.addEventListener("click", () => { const input = root.querySelector("#student-admission-number"); if (input) input.value = nextAdmissionNumber(); });
    root.querySelector("[data-student-camera]")?.addEventListener("click", startStudentCamera);
    root.querySelector("[data-capture-photo]")?.addEventListener("click", captureStudentPhoto);
    root.querySelectorAll("[data-admission-field]").forEach((input) => input.addEventListener("input", () => { input.closest(".admit-field")?.classList.remove("invalid"); const error = input.closest(".admit-field")?.querySelector(".admit-error-text"); if (error) error.textContent = ""; const formErrorSlot = input.closest("form")?.querySelector(".admin-form-error"); if (formErrorSlot) formErrorSlot.textContent = ""; }));
    root.querySelector("#student-batch")?.addEventListener("change", updateStudentSubjects);
    root.querySelector("#student-subject-search")?.addEventListener("input", filterStudentSubjects);
    root.querySelector("#attendance-batch")?.addEventListener("change", render);
    root.querySelector("#attendance-date")?.addEventListener("change", render);
    root.querySelectorAll("[data-mark]").forEach((button) => button.addEventListener("click", () => { const row = button.closest("[data-attendance-row]"); row.querySelectorAll("[data-mark]").forEach((item) => item.classList.toggle("selected", item === button)); row.dataset.status = button.dataset.mark; }));
    root.querySelector("[data-save-attendance]")?.addEventListener("click", saveAttendance);
    root.querySelector("[data-export]")?.addEventListener("click", exportVisible);
    root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { root.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button)); root.querySelectorAll("[data-tab-panel]").forEach((panel) => { panel.hidden = panel.dataset.tabPanel !== button.dataset.tab; }); }));
    root.querySelectorAll("[data-admin-period]").forEach((button) => button.addEventListener("click", () => {
      enrollmentPeriod = button.dataset.adminPeriod;
      root.querySelectorAll("[data-admin-period]").forEach((item) => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      const chart = root.querySelector(".admin-chart-wrap");
      if (chart) chart.innerHTML = enrollmentChartMarkup(enrollmentPeriod);
    }));
    root.querySelectorAll("[data-thread]").forEach((button) => button.addEventListener("click", () => { selectedThread = button.dataset.thread; render(); }));
    root.querySelectorAll("[data-filter-course], #student-filter-course, #student-filter-batch").forEach((control) => control.addEventListener("change", filterStudents));
    root.querySelectorAll("[data-live-filter]").forEach((button) => button.addEventListener("click", () => { liveClassFilter = button.dataset.liveFilter; render(); }));
    root.querySelectorAll("[data-live-platform-open]").forEach((button) => button.addEventListener("click", () => { showLiveClassDialog(); liveClassPlatform = button.dataset.livePlatformOpen; updateLivePlatformNotice(); }));
    root.querySelectorAll("[data-live-action]").forEach((button) => button.addEventListener("click", () => handleLiveClassAction(button.dataset.liveAction, button.dataset.id || "")));
    root.querySelectorAll("[data-student-action]").forEach((button) => button.addEventListener("click", () => handleStudentAction(button.dataset.studentAction, button.dataset.id)));
    root.querySelectorAll("[data-staff-action]").forEach((button) => button.addEventListener("click", () => handleStaffAction(button.dataset.staffAction, button.dataset.id || "")));
    root.querySelectorAll("[data-staff-status]").forEach((button) => button.addEventListener("click", () => { root.querySelectorAll("[data-staff-status]").forEach((item) => item.classList.toggle("active", item === button)); filterStaff(); }));
    root.querySelectorAll("[data-staff-role]").forEach((button) => button.addEventListener("click", () => { root.querySelectorAll("[data-staff-role]").forEach((item) => item.classList.toggle("active", item === button)); filterStaff(); }));
    root.querySelectorAll("[data-staff-view]").forEach((button) => button.addEventListener("click", () => { const records = root.querySelector("[data-staff-records]"); if (!records) return; records.classList.toggle("staff-list-view", button.dataset.staffView === "list"); records.classList.toggle("staff-grid-view", button.dataset.staffView === "grid"); root.querySelectorAll("[data-staff-view]").forEach((item) => item.classList.toggle("active", item === button)); try { sessionStorage.setItem("cs-admin-staff-view", button.dataset.staffView); } catch { /* The view remains usable without storage. */ } }));
    root.querySelector("[data-staff-search]")?.addEventListener("input", filterStaff);
    root.querySelectorAll("[data-staff-cancel]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); const form = root.querySelector('[data-admin-form="staff-record"]'); if (!form?.dataset.dirty || window.confirm("Discard your unsaved staff changes?")) location.hash = "staff"; }));
    root.querySelectorAll('input[name="employmentType"]').forEach((input) => input.addEventListener("change", updateStaffEmployment));
    root.querySelectorAll("[data-staff-password-toggle]").forEach((button) => button.addEventListener("click", () => { const input = button.parentElement.querySelector("input"); if (!input) return; const reveal = input.type === "password"; input.type = reveal ? "text" : "password"; button.textContent = reveal ? "Hide" : "Show"; button.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} password`); }));
    root.querySelector('[data-admin-form="staff-record"]')?.addEventListener("input", updateStaffSummary);
    root.querySelector('[data-admin-form="staff-record"]')?.addEventListener("input", (event) => { if (event.target.name !== "photoFile") event.currentTarget.dataset.dirty = "true"; });
    root.querySelector("#staff-photo")?.addEventListener("change", previewStaffPhoto);
    root.querySelector("[data-staff-add-assignment]")?.addEventListener("click", addStaffAssignment);
    root.querySelectorAll("[data-staff-remove-assignment]").forEach((button) => button.addEventListener("click", () => removeStaffAssignment(Number(button.dataset.staffRemoveAssignment))));
    root.querySelector('[name="assignmentCourse"]')?.addEventListener("change", updateStaffAssignmentOptions);
    root.querySelector('[name="ifsc"]')?.addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11); });
    root.querySelector('[name="pan"]')?.addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); });
    root.querySelector("#students-search")?.addEventListener("input", applyStudentFilters);
    root.querySelector("#students-filter")?.addEventListener("click", applyStudentFilters);
    root.querySelector("#students-clear")?.addEventListener("click", clearStudentFilters);
    root.querySelector("#students-sort")?.addEventListener("change", applyStudentFilters);
    root.querySelector("#students-batch")?.addEventListener("change", applyStudentFilters);
    root.querySelector("#students-status")?.addEventListener("change", applyStudentFilters);
  }
  function reportClick(event) { selectedReport = event.currentTarget.dataset.report; go("reports/view"); }
  function filterStudents() {
    const c = root.querySelector("#student-filter-course")?.value || "", b = root.querySelector("#student-filter-batch")?.value || "";
    root.querySelectorAll("[data-filter-row][data-course]").forEach((row) => { row.hidden = (c && row.dataset.course !== c) || (b && row.dataset.batch !== b); });
  }
  function applyStudentFilters() {
    const term = (root.querySelector("#students-search")?.value || "").trim().toLowerCase();
    const batchId = root.querySelector("#students-batch")?.value || "";
    const status = root.querySelector("#students-status")?.value || "";
    root.querySelectorAll("[data-student-row]").forEach((row) => {
      row.hidden = (!row.dataset.search.includes(term)) || (batchId && row.dataset.batch !== batchId) || (status && row.dataset.status.toLowerCase() !== status.toLowerCase());
    });
    const direction = root.querySelector("#students-sort")?.value || "admission-asc";
    const body = root.querySelector(".students-table tbody");
    if (body) [...body.querySelectorAll("[data-student-row]")].sort((a, b) => (a.dataset[direction.startsWith("name") ? "name" : "admission"] || "").localeCompare(b.dataset[direction.startsWith("name") ? "name" : "admission"] || "") * (direction.endsWith("desc") ? -1 : 1)).forEach((row) => body.append(row));
  }
  function clearStudentFilters() {
    ["#students-search", "#students-batch", "#students-status"].forEach((selector) => { const field = root.querySelector(selector); if (field) field.value = ""; });
    const sort = root.querySelector("#students-sort"); if (sort) sort.value = "admission-asc";
    root.querySelectorAll("[data-student-row]").forEach((row) => { row.hidden = false; });
  }
  function filterRows(query) {
    const term = String(query || "").trim().toLowerCase();
    root.querySelectorAll("[data-filter-row]").forEach((row) => { row.hidden = !row.textContent.toLowerCase().includes(term); });
    root.querySelectorAll("[data-filter-card]").forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(term); });
  }
  function handleAction(action) {
    if (action === "logout") location.href = "login.html";
    if (action === "notifications") showDialog("Notifications", `<div class="admin-note-box">This prototype has no connected notification service.</div><p>Recent demo events stay in this browser only.</p>`);
    if (action === "settings") showDialog("Workspace settings", `<div class="admin-note-box">Settings are preview-only. No account or institute settings are sent anywhere.</div><label class="field-label">Institute name<input class="form-control" value="JEE Mentor" disabled /></label>`);
    if (action === "print") window.print();
    if (action === "close-dialog") dialog?.close();
    if (action === "refresh-insights") toast("Predictive insights refreshed using local demo values.");
    if (action === "close-sidebar") root.querySelector(".sidebar")?.classList.remove("open");
    if (action === "meta-checklist") showDialog("Meta Lead Ads setup checklist", `<ol><li>Confirm business account ownership.</li><li>Review data access and privacy.</li><li>Configure an approved server-side integration in a later phase.</li></ol><p>No credentials are requested here.</p>`);
    if (action === "new-sequence") showDialog("Create lead nurturing sequence", `<form data-admin-form="sequence" novalidate>${field("Sequence name", "name", "text", { required: true })}${field("Audience", "audience", "select", { value: "New inquiries", choices: [["New inquiries", "New inquiries"], ["All leads", "All leads"]] })}<div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button type="submit" class="primary-action">Save draft</button></div></form>`);
    if (action === "schedule-live-class") showLiveClassDialog();
    if (action === "configure-live-platforms") showLivePlatformSetup();
  }
  function showDialog(title, content, actions = "") {
    if (!dialog || !dialogBody) return;
    dialogBody.innerHTML = `<h2>${esc(title)}</h2><p>This is a local demo interaction. No request is sent to an external service.</p>${content}${actions ? `<div class="dialog-actions">${actions}</div>` : ""}`;
    if (!dialog.open) dialog.showModal();
  }
  function handleDialogAction(action, id) {
    if (action === "collect") showPaymentDialog(id);
    if (action === "receipt") showReceipt(id);
    if (action === "delete-demo") showDialog("Remove demo record?", `<p>This removes only the selected record from the Admin demo data stored in this browser.</p>`, `<button class="secondary-action" data-action="close-dialog">Cancel</button><button class="danger-action" data-confirm-delete="${esc(id)}">Remove record</button>`);
    if (action === "print") window.print();
  }
  function deleteDemoRecord(compound) {
    const [collection, id] = compound.split(":");
    if (!Array.isArray(data[collection])) return;
    commit("Demo record removed.", (draft) => { draft[collection] = draft[collection].filter((item) => item.id !== id); });
    dialog?.close();
  }

  function filterStaff() {
    const records = root.querySelectorAll("[data-staff-record]");
    const search = (root.querySelector("[data-staff-search]")?.value || "").trim().toLowerCase();
    const status = root.querySelector("[data-staff-status].active")?.dataset.staffStatus || "all";
    const role = root.querySelector("[data-staff-role].active")?.dataset.staffRole || "All";
    let visible = 0;
    records.forEach((item) => { const matches = (!search || item.dataset.name.includes(search)) && (status === "all" || item.dataset.status === status) && (role === "All" || item.dataset.role === role); item.hidden = !matches; if (matches) visible += 1; });
    const cards = root.querySelector(".staff-card-grid"); if (cards) cards.hidden = !visible;
    const tableWrap = root.querySelector(".staff-table-wrap"); if (tableWrap) tableWrap.hidden = !visible;
    const noResults = root.querySelector(".staff-no-results"); if (noResults) noResults.hidden = visible > 0 || records.length === 0;
  }
  function staffDetail(item) {
    const assignments = (item.subjectAssignments || []).map((entry) => `<li>${esc(course(entry.courseId)?.name || "Course")} · ${esc(entry.subject)} · ${esc(batch(entry.batchId)?.name || "All batches")}</li>`).join("") || "<li>None</li>";
    const account = String(item.bankAccount || "");
    return `<dl class="staff-detail-grid"><dt>Account</dt><dd>${esc(item.email || "—")} · ${esc(item.phone || "—")}</dd><dt>Employment</dt><dd>${esc(item.employmentType || "—")} · ${esc(staffTypeOf(item))}</dd><dt>Employee ID</dt><dd>${esc(item.employeeId || "—")}</dd><dt>Bank</dt><dd>${esc(item.bankName || "—")} · ${account ? `•••• ${esc(account.slice(-4))}` : "No account saved"}</dd><dt>IFSC / PAN</dt><dd>${esc(item.ifsc || "—")} / ${esc(item.pan || "—")}</dd><dt>Qualification</dt><dd>${esc(item.qualification || "—")}</dd><dt>Specialization</dt><dd>${esc(item.specialization || "—")}</dd><dt>Experience / Joined</dt><dd>${esc(item.experienceYears || "—")} years · ${esc(item.joiningDate ? dateLabel(item.joiningDate) : "—")}</dd><dt>Subjects and batches</dt><dd><ul>${assignments}</ul></dd><dt>Payroll this month</dt><dd>${staffActive(item) ? money(item.monthlySalary || item.salary || 0) : "Inactive"}</dd></dl>`;
  }
  function handleStaffAction(action, id) {
    const item = staff(id);
    if (action === "import") { showDialog("Import staff CSV", `<p>Choose a CSV with columns name,email,phone,staffType,employmentType,salary. Duplicate emails are skipped. The file stays in this browser.</p><form data-admin-form="staff-import" novalidate><label class="field-label">CSV file<input class="form-control" type="file" name="csvFile" accept=".csv,text/csv" required></label><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button type="submit" class="primary-action">Import staff</button></div></form>`); return; }
    if (action === "sample") { const blob = new Blob(["name,email,phone,staffType,employmentType,salary\r\nSample Teacher,teacher@example.com,9876543210,Teacher,Full-Time,45000\r\n"], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "staff-import-sample.csv"; link.click(); URL.revokeObjectURL(url); return; }
    if (!item) return;
    if (action === "view") { showDialog(item.name, staffDetail(item)); return; }
    if (action === "edit") { location.hash = `staff-edit/${encodeURIComponent(item.id)}`; return; }
    if (action === "toggle") { const next = staffActive(item) ? "Inactive" : "Active"; commit(`Staff marked ${next.toLowerCase()}.`, (draft) => { const target = draft.staff.find((entry) => entry.id === item.id); target.status = next; }); return; }
    if (action === "reset") { toast("Password reset is unavailable until staff authentication is supported by the server.", true); return; }
    if (action === "delete") { showDialog("Delete staff member?", `<p>This removes the local profile permanently. Historical assignments are kept, so a staff member used by a batch or timetable cannot be deleted.</p>`, `<button class="secondary-action" data-action="close-dialog">Cancel</button><button class="danger-action" data-confirm-staff-delete="${esc(item.id)}">Delete staff</button>`); }
  }
  function deleteStaffRecord(id) {
    const assigned = data.batches.some((entry) => entry.teacherId === id) || (data.timetable || []).some((entry) => entry.teacherId === id) || data.liveClasses.some((entry) => entry.teacherId === id);
    if (assigned) { dialog?.close(); toast("This staff member is assigned to a batch or timetable. Reassign them before deleting.", true); return; }
    commit("Staff member deleted.", (draft) => { draft.staff = draft.staff.filter((entry) => entry.id !== id); }); dialog?.close();
  }
  function filterStaffCsv(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
    const cells = (line) => { const out = []; let cell = "", quoted = false; for (let index = 0; index < line.length; index += 1) { const char = line[index]; if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index += 1; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { out.push(cell.trim()); cell = ""; } else cell += char; } out.push(cell.trim()); return out; };
    if (!lines.length) return [];
    const headers = cells(lines[0]).map((value) => value.toLowerCase().replace(/\s+/g, ""));
    return lines.slice(1).map((line) => Object.fromEntries(cells(line).map((value, index) => [headers[index], value]))).filter((item) => item.name && item.email);
  }
  function staffFormError(form, name, message) {
    const slots = [...form.querySelectorAll(`[data-staff-error="${name}"]`)];
    const slot = slots.find((entry) => !entry.closest("[hidden]")) || slots[0];
    if (slot) slot.textContent = message;
    const matchingField = [...form.querySelectorAll(`[name="${name}"]`)].find((entry) => !entry.closest("[hidden]"));
    const field = matchingField?.closest(".staff-field") || slot?.closest(".staff-field");
    field?.scrollIntoView({ behavior: "smooth", block: "center" }); field?.querySelector("input,select")?.focus();
    const summary = form.querySelector("[data-staff-form-error]"); if (summary) summary.textContent = message;
  }
  function updateStaffEmployment() {
    const form = root.querySelector('[data-admin-form="staff-record"]'), value = form?.querySelector('input[name="employmentType"]:checked')?.value || "Full-Time";
    form?.querySelectorAll("[data-staff-pay-fields]").forEach((element) => { element.hidden = element.dataset.staffPayFields !== value; });
    const notes = { "Full-Time": "Payroll = Monthly Salary × (Present Days / Working Days). PF & TDS deducted on gross.", Contractual: "Payroll = Classes taught × Per-class rate. TDS deducted on gross.", "Part-Time / Hybrid": "Payroll = Base Salary + (Classes taught × Per-class rate), pro-rated by attendance.", "Hourly Basis": "Payroll = Approved working hours × Hourly rate. TDS deducted on gross." };
    const note = form?.querySelector("[data-staff-payroll-note]"); if (note) note.textContent = notes[value] || notes["Full-Time"];
    updateStaffSummary();
  }
  function updateStaffSummary() {
    const form = root.querySelector('[data-admin-form="staff-record"]'); if (!form) return;
    const values = new FormData(form), getValue = (key) => [...form.querySelectorAll(`[name="${key}"]`)].find((entry) => !entry.closest("[hidden]"))?.value || "", name = String(values.get("name") || "").trim() || "New Teacher", email = String(values.get("email") || "").trim() || "No email entered", type = String(values.get("employmentType") || "Full-Time");
    const amountName = type === "Full-Time" ? "monthlySalary" : type === "Contractual" ? "perClassRate" : type === "Part-Time / Hybrid" ? "baseSalary" : "hourlyRate";
    const amount = Number(getValue(amountName) || 0), pay = type === "Contractual" ? `${money(amount)}/class` : type === "Hourly Basis" ? `${money(amount)}/hour` : type === "Part-Time / Hybrid" ? `${money(amount)} + ${money(getValue("perClassRate") || 0)}/class` : `${money(amount)}/month`;
    form.querySelector("[data-staff-summary-name]").textContent = name; form.querySelector("[data-staff-summary-email]").textContent = email; form.querySelector("[data-staff-summary-employment]").textContent = type; form.querySelector("[data-staff-summary-pay]").textContent = pay;
    const avatar = form.querySelector("[data-staff-summary-avatar]"); if (avatar && !staffPhotoData) avatar.textContent = staffInitials(name);
    const preview = form.querySelector("[data-staff-photo-preview]"); if (preview && !staffPhotoData) preview.textContent = staffInitials(name);
  }
  function previewStaffPhoto(event) {
    const file = event.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Choose an image smaller than 2 MB.", true); event.target.value = ""; return; }
    const reader = new FileReader(); reader.onload = () => { staffPhotoData = String(reader.result || ""); const preview = root.querySelector("[data-staff-photo-preview]"); if (preview) preview.innerHTML = `<img src="${esc(staffPhotoData)}" alt="Staff photo preview">`; const avatar = root.querySelector("[data-staff-summary-avatar]"); if (avatar) avatar.innerHTML = `<img src="${esc(staffPhotoData)}" alt="">`; const form = event.target.closest("form"); if (form) form.dataset.dirty = "true"; }; reader.readAsDataURL(file);
  }
  function updateStaffAssignmentOptions() {
    const form = root.querySelector('[data-admin-form="staff-record"]'), courseId = form?.elements.namedItem("assignmentCourse")?.value, selectedCourse = course(courseId);
    const subjects = (selectedCourse?.subjects?.length ? selectedCourse.subjects : staffSubjects()).map((subject) => [subject, subject]);
    const subjectSelect = form?.elements.namedItem("assignmentSubject"); if (subjectSelect) subjectSelect.innerHTML = `<option value="">Select subject</option>${subjects.map(([value, label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join("")}`;
    const batches = data.batches.filter((entry) => !courseId || entry.courseId === courseId), batchSelect = form?.elements.namedItem("assignmentBatch"); if (batchSelect) batchSelect.innerHTML = `<option value="">All batches</option>${batches.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("")}`;
  }
  function addStaffAssignment() {
    const form = root.querySelector('[data-admin-form="staff-record"]'), courseId = form?.elements.namedItem("assignmentCourse")?.value || "", subject = form?.elements.namedItem("assignmentSubject")?.value || "", batchId = form?.elements.namedItem("assignmentBatch")?.value || "";
    if (!courseId || !subject) { toast("Choose a course and subject first.", true); return; }
    if (staffPendingAssignments.some((entry) => entry.courseId === courseId && entry.subject === subject && entry.batchId === batchId)) { toast("That subject assignment is already listed.", true); return; }
    staffPendingAssignments.push({ courseId, subject, batchId }); form.dataset.dirty = "true"; renderStaffAssignments();
  }
  function renderStaffAssignments() {
    const list = root.querySelector("[data-staff-assignment-list]"); if (!list) return;
    list.innerHTML = staffPendingAssignments.map((entry, index) => `<span class="staff-assignment-chip">${esc(course(entry.courseId)?.name || "Course")} · ${esc(entry.subject)}${entry.batchId ? ` · ${esc(batch(entry.batchId)?.name || "Batch")}` : ""}<button type="button" data-staff-remove-assignment="${index}" aria-label="Remove ${esc(entry.subject)}">×</button></span>`).join("");
    list.querySelectorAll("[data-staff-remove-assignment]").forEach((button) => button.addEventListener("click", () => removeStaffAssignment(Number(button.dataset.staffRemoveAssignment))));
  }
  function removeStaffAssignment(index) { staffPendingAssignments.splice(index, 1); renderStaffAssignments(); const form = root.querySelector('[data-admin-form="staff-record"]'); if (form) form.dataset.dirty = "true"; }

  function render() { route = readRoute(); if (route !== "students/new" && cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; } shell(); }
  function renderPage() {
    const navItem = routeMetaById.get(route);
    if (navItem?.placeholder) return roadmapPage(navItem);
    if (route === "dashboard") return dashboard();
    if (route === "courses") return coursesPage();
    if (route === "courses/new") return courseForm();
    if (route === "batches") return batchesPage();
    if (route === "batches/new") return batchForm();
    if (route === "students") return studentsPage();
    if (route === "students/new") return studentForm();
    if (route.startsWith("student/")) return studentProfile(route.split("/")[1]);
    if (route === "fees") return billingPage();
    if (route === "fees/assign") return feeForm();
    if (route === "payments") return paymentsPage();
    if (route === "academic-years") return academicYearsPage();
    if (route === "academic-years/new") return academicYearForm();
    if (route === "staff") return staffPage();
    if (route === "staff/new" || route === "staff-create") return staffForm();
    if (route.startsWith("staff-edit/")) return staffForm(staff(route.split("/")[1]));
    if (route === "leads") return leadsPage();
    if (route === "leads/new") return leadForm();
    if (route === "meta-leads") return metaLeadPage();
    if (route === "lead-nurturing") return nurturingPage();
    if (route === "billing") return billingPage();
    if (route === "live-classes") return liveClassesPage();
    if (route === "live-classes/new") return liveClassForm();
    if (route === "reports") return reportsPage();
    if (route.startsWith("reports/detail/")) return reportDetail(route.slice("reports/detail/".length));
    if (route === "reports/view") return reportDetail(selectedReport || "student-details");
    if (route === "ptm") return ptmPage();
    if (route === "ptm/new") return ptmForm();
    if (route === "broadcast") return broadcastPage();
    if (route === "messages") return messagesPage();
    if (route === "test-series") return testSeriesPage();
    if (route === "test-series/new") return testSeriesForm();
    if (route === "exams" || route === "offline-exams") return examsPage(route === "offline-exams" ? "Offline" : "Online");
    if (route === "exams/new") return examForm();
    if (route === "question-bank") return questionBankPage();
    if (route === "question-bank/new") return questionForm();
    if (route === "homework") return homeworkPage();
    if (route === "homework/new") return homeworkForm();
    if (route === "attendance") return attendancePage();
    if (route === "timetable") return timetablePage();
    if (route === "settings") return settingsPage();
    if (route === "profile") return profilePage();
    if (["library", "certificates", "id-cards", "expenses", "payroll", "salary", "results", "marks", "materials", "subjects", "topics", "fee-structures", "discounts", "payment-reminders", "staff-attendance", "payslips", "video-lectures"].includes(route)) return deferredPage(route);
    if (route === "admissions") return admissionsPage();
    if (route === "settings") return settingsPage();
    if (route === "profile") return profilePage();
    return deferredPage(route);
  }
  function pageHeading(title, subtitle = "", action = "") { return `<div class="page-title-row"><div><div class="breadcrumb">Administrator / ${esc(title)}</div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${action}</div>`; }
  function button(label, routeTo, style = "primary-action") { return `<a class="${style}" href="#${routeTo}" data-route="${routeTo}">${label}</a>`; }
  function statCard(label, value, tone = "blue", helper = "") { return `<article class="admin-stat ${tone}"><small>${esc(label)}</small><strong>${esc(value)}</strong>${helper ? `<span>${esc(helper)}</span>` : ""}</article>`; }
  function panel(title, body, link = "") { return `<section class="panel admin-panel"><header class="panel-head"><h2>${title}</h2>${link}</header><div class="panel-body">${body}</div></section>`; }
  function empty(title, body, action = "") { return `<div class="admin-empty-state"><span>▱</span><b>${esc(title)}</b><p>${esc(body)}</p>${action}</div>`; }
  function field(label, name, type = "text", options = {}) {
    const { required = false, value = "", placeholder = "", help = "", min = "", step = "", choices = [], wide = false } = options;
    const klass = `field-label${wide ? " span-two" : ""}`;
    let control = type === "textarea" ? `<textarea class="form-area" name="${name}" ${required ? "required" : ""} placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : type === "select" ? `<select class="form-control" name="${name}" ${required ? "required" : ""}><option value="">Select ${esc(label.toLowerCase())}</option>${choices.map(([id, text]) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>` : `<input class="form-control" name="${name}" type="${type}" ${required ? "required" : ""} ${min ? `min="${min}"` : ""} ${step ? `step="${step}"` : ""} value="${esc(value)}" placeholder="${esc(placeholder)}" />`;
    return `<label class="${klass}">${esc(label)}${required ? " <em>*</em>" : ""}${control}${help ? `<small>${esc(help)}</small>` : ""}</label>`;
  }
  function formPage(title, description, id, sections, submitLabel = "Save") {
    return `${pageHeading(title, description, `<a class="secondary-action" href="javascript:history.back()">← Back</a>`)}<form class="admin-form-card" data-admin-form="${id}" novalidate>${sections}<div class="admin-form-error" aria-live="polite"></div><div class="admin-form-actions"><a class="secondary-action" href="#${route.split("/")[0]}" data-route="${route.split("/")[0]}">Cancel</a><button class="primary-action" type="submit">${esc(submitLabel)}</button></div></form>`;
  }
  function section(title, hint, fields) { return `<fieldset class="admin-form-section"><legend>${esc(title)}</legend>${hint ? `<p>${esc(hint)}</p>` : ""}<div class="admin-form-grid">${fields}</div></fieldset>`; }
  function table(title, columns, rows, actions = "") {
    return `<section class="panel admin-table-panel"><div class="admin-table-toolbar"><div><b>${esc(title)}</b><small>${rows.length} record${rows.length === 1 ? "" : "s"}</small></div><div class="admin-toolbar-actions"><input id="table-search" class="search-control" type="search" placeholder="Search ${esc(title.toLowerCase())}…" aria-label="Search ${esc(title)}"/>${actions}</div></div><div class="table-wrap"><table class="data-table"><thead><tr>${columns.map((col) => `<th>${esc(col)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${columns.length}">${empty(`No ${title.toLowerCase()} yet`, "Create a record to see it here.")}</td></tr>`}</tbody></table></div></section>`;
  }
  function personCell(name, secondary = "") { const initials = String(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); return `<span class="admin-person"><i>${esc(initials)}</i><span><b>${esc(name)}</b>${secondary ? `<small>${esc(secondary)}</small>` : ""}</span></span>`; }
  function actionLink(label, routeTo) { return `<a class="admin-inline-link" href="#${routeTo}" data-route="${routeTo}">${esc(label)} →</a>`; }

  function dashboard() {
    const revenue = data.payments.filter((item) => item.date?.startsWith("2026-10")).reduce((sum, item) => sum + Number(item.amount), 0);
    const outstanding = data.fees.reduce((sum, item) => sum + balance(item.id), 0);
    const totalFees = data.fees.reduce((sum, item) => sum + Number(item.total), 0);
    const paidTotal = data.payments.reduce((sum, item) => sum + Number(item.amount), 0);
    const collection = totalFees ? (paidTotal / totalFees * 100).toFixed(1) : "0.0";
    const atRisk = data.students.filter((item) => attendanceRate(item.id) < 75).length;
    const tx = [...data.payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
    const bars = [0, 0, 0, 0, 0, revenue];
    return `<div class="admin-dashboard">
      <section class="admin-setup-banner"><div class="admin-setup-icon">🎓</div><div class="admin-setup-copy"><strong>Setup Progress — 7/16 steps complete</strong><span>Next: Build Timetable · 10 min</span></div><strong class="admin-setup-percent">44%</strong><a class="admin-setup-continue" href="#timetable" data-route="timetable">Continue: Build Timetable →</a><div class="admin-setup-track"><i></i></div></section>
      <section class="admin-overview-grid"><article class="admin-welcome"><div class="admin-welcome-copy"><strong>JEE Mentor</strong><span>▣ Monday, 19 October 2026</span><small>Local institute overview · demo data</small><div class="admin-welcome-pills"><span>♟ ${data.students.length} Students</span><span>₹ ${money(revenue)} This Month</span></div></div><div class="admin-welcome-art" aria-hidden="true"><svg viewBox="0 0 260 190"><circle cx="206" cy="37" r="30" fill="#a992ff" opacity=".7"/><rect x="28" y="26" width="176" height="120" rx="16" fill="#1c2f98"/><rect x="38" y="36" width="156" height="99" rx="8" fill="#fff"/><rect x="48" y="47" width="136" height="18" rx="5" fill="#e9efff"/><circle cx="61" cy="56" r="4" fill="#2862ec"/><rect x="52" y="78" width="42" height="45" rx="6" fill="#f3f6ff"/><rect x="101" y="78" width="74" height="45" rx="6" fill="#f3f6ff"/><rect x="59" y="101" width="8" height="16" rx="3" fill="#19bd9a"/><rect x="72" y="91" width="8" height="26" rx="3" fill="#7858eb"/><rect x="85" y="85" width="5" height="32" rx="2" fill="#ffad35"/><path d="M108 112l15-12 13 8 20-19" fill="none" stroke="#ed4ca1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 147h203l-18 18H34z" fill="#cbd8ff"/></svg></div></article>
        <div class="admin-metric-grid"><a class="admin-metric metric-students" href="#students" data-route="students"><strong>${data.students.length}</strong><span>STUDENTS</span><small>In this demo workspace</small><i>♟</i></a><a class="admin-metric metric-revenue" href="#billing" data-route="billing"><strong>${money(revenue)}</strong><span>REVENUE (MONTH)</span><small>${money(outstanding)} pending</small><i>▣</i></a><a class="admin-metric metric-risk" href="#students" data-route="students"><strong>${atRisk}</strong><span>AT-RISK STUDENTS</span><small>${atRisk ? "Needs attention" : "All clear"}</small><i>△</i></a><a class="admin-metric metric-collection" href="#billing" data-route="billing"><strong>${collection}%</strong><span>FEE COLLECTION</span><small>${data.staff.length} staff · ${data.batches.length} batches</small><i>◕</i></a></div></section>
      <nav class="admin-quick-actions" aria-label="Dashboard shortcuts">${[["Add Student","user-plus","students/new"],["New Exam","exam-plus","exams/new"],["Attendance","calendar-dots","attendance"],["Fees","banknote-coin","fees/assign"],["Broadcast","megaphone","broadcast"],["Homework","list-notebook","homework/new"],["Lead CRM","crm-list","leads"],["Reports","chart-bars","reports"]].map(([label, icon, link]) => `<a class="admin-shortcut" href="#${link}" data-route="${link}"><span class="admin-shortcut-icon">${navIcon(icon)}</span><b>${label}</b></a>`).join("")}</nav>
      <section class="admin-analytics-grid"><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph pink">⌁</span>Student Enrollment Trend</h2><div class="admin-range-tabs" role="group" aria-label="Enrollment trend period"><button class="${enrollmentPeriod === "Monthly" ? "active" : ""}" data-admin-period="Monthly" aria-pressed="${enrollmentPeriod === "Monthly"}">Monthly</button><button class="${enrollmentPeriod === "Quarterly" ? "active" : ""}" data-admin-period="Quarterly" aria-pressed="${enrollmentPeriod === "Quarterly"}">Quarterly</button><button class="${enrollmentPeriod === "Yearly" ? "active" : ""}" data-admin-period="Yearly" aria-pressed="${enrollmentPeriod === "Yearly"}">Yearly</button></div></header><div class="admin-chart-wrap">${enrollmentChartMarkup(enrollmentPeriod)}</div></article><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph">▥</span>Fee Collection Overview</h2><small>Calculated from saved fee records</small></header><div class="admin-collection-overview"><div class="admin-donut" style="--donut:#2862ec 0 ${collection}%,#e8edf6 ${collection}% 100%"><span>${collection}%<small>COLLECTED</small></span></div><div class="admin-collection-legend"><div><i></i>Collected<strong>${money(paidTotal)}</strong></div><div><i></i>Pending<strong>${money(outstanding)}</strong></div><a href="#billing" data-route="billing">Open billing hub →</a></div></div></article></section>
      <section class="admin-lower-grid">${panel("Today's Classes", `<div class="admin-attendance-strip"><div><b>TODAY'S ATTENDANCE SPLIT</b><span>UNMARKED</span></div><i><span></span></i><small><span>ⓘ No student records submitted today</span><a href="#attendance" data-route="attendance">Mark Now →</a></small></div><div class="admin-empty"><span>▣</span><b>No classes today</b></div>`, actionLink("View timetable", "timetable"))}</section>
      ${adminDashboardMore(tx, outstanding, collection, bars)}
    </div>`;
  }
  function enrollmentChartMarkup(period) {
    const now = new Date(`${today}T00:00:00`);
    let intervals;
    if (period === "Quarterly") {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      intervals = Array.from({ length: 8 }, (_, index) => {
        const ordinal = now.getFullYear() * 4 + currentQuarter - (7 - index);
        const year = Math.floor(ordinal / 4);
        const quarter = ordinal - year * 4 + 1;
        return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` };
      });
    } else if (period === "Yearly") {
      intervals = Array.from({ length: 5 }, (_, index) => {
        const year = now.getFullYear() - 4 + index;
        return { key: String(year), label: String(year) };
      });
    } else {
      intervals = Array.from({ length: 12 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        return { key: `${year}-${month}`, label: new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(date) };
      });
    }

    const values = intervals.map(({ key }) => data.students.filter((item) => {
      const date = String(item.admissionDate || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      if (period === "Yearly") return date.slice(0, 4) === key;
      if (period === "Quarterly") {
        const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
        return `${date.slice(0, 4)}-Q${quarter}` === key;
      }
      return date.slice(0, 7) === key;
    }).length);

    const width = 900, height = 230, left = 42, right = 16, top = 14, bottom = 46;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const rawMax = Math.max(0, ...values);
    const tickStep = Math.max(1, Math.ceil(rawMax / 4));
    const max = Math.max(1, Math.ceil(rawMax / tickStep) * tickStep);
    const points = values.map((value, index) => ({
      x: left + plotWidth * index / Math.max(1, values.length - 1),
      y: top + plotHeight * (1 - value / max)
    }));
    const path = points.map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1], before = points[index - 2] || previous, next = points[index + 1] || point;
      const control1x = previous.x + (point.x - before.x) / 6;
      const control1y = Math.max(Math.min(previous.y, point.y), Math.min(Math.max(previous.y, point.y), previous.y + (point.y - before.y) / 6));
      const control2x = point.x - (next.x - previous.x) / 6;
      const control2y = Math.max(Math.min(previous.y, point.y), Math.min(Math.max(previous.y, point.y), point.y - (next.y - previous.y) / 6));
      return `C ${control1x} ${control1y}, ${control2x} ${control2y}, ${point.x} ${point.y}`;
    }).join(" ");
    const baseline = height - bottom;
    const fillPath = `${path} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
    const ticks = Array.from({ length: Math.floor(max / tickStep) + 1 }, (_, index) => index * tickStep);
    const grid = ticks.map((tick) => {
      const y = top + plotHeight * (1 - tick / max);
      return `<line class="admin-chart-grid${tick === 0 ? " admin-chart-baseline" : ""}" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="admin-chart-y" x="${left - 11}" y="${y + 4}" text-anchor="end">${tick}</text>`;
    }).join("");
    const labelCount = Math.min(6, intervals.length);
    const labelIndexes = new Set(Array.from({ length: labelCount }, (_, index) => Math.round(index * (intervals.length - 1) / Math.max(1, labelCount - 1))));
    const labels = intervals.map(({ label }, index) => labelIndexes.has(index) ? `<text class="admin-chart-x" x="${points[index].x}" y="${height - 10}" text-anchor="middle">${esc(label)}</text>` : "").join("");
    const circles = points.map((point) => `<circle class="admin-chart-point" cx="${point.x}" cy="${point.y}" r="3.6"/>`).join("");
    return `<svg class="admin-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(period)} student admissions trend: ${values.reduce((sum, value) => sum + value, 0)} students in the displayed period"><title>${esc(period)} student enrollment trend</title><desc>Admissions are counted from each student's saved admission date.</desc><defs><linearGradient id="admin-enrollment-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ec4899" stop-opacity=".25"/><stop offset="100%" stop-color="#ec4899" stop-opacity="0"/></linearGradient></defs>${grid}<path class="admin-chart-area" d="${fillPath}"/><path class="admin-chart-line" d="${path}"/>${circles}${labels}</svg>`;
  }
  function adminDashboardMore(transactions, outstanding, collection, bars) {
    const recent = transactions.length ? transactions.map((payment) => { const learner = student(payment.studentId); return `<div class="admin-transaction"><span class="admin-transaction-icon">▱</span><div>${personCell(learner?.name || "Student", `${fee(payment.feeId)?.title || "Fee payment"} · ${payment.note || payment.method}`)}</div><div class="admin-transaction-amount"><b>+${money(payment.amount)}</b><small>${dateLabel(payment.date)}</small></div></div>`; }).join("") : empty("No transactions yet", "Collected demo payments will appear here.", actionLink("Collect a payment", "payments"));
    const revenueBars = ["MAY", "JUN", "JUL", "AUG", "SEP", "OCT"].map((month, index) => `<div><span class="admin-revenue-value">${bars[index] ? money(bars[index]) : ""}</span><i class="${bars[index] ? "has-value" : ""}" style="--bar-height:${bars[index] ? Math.min(100, 12 + bars[index] / 1000) : 5}%"></i><b>${month}</b></div>`).join("");
    return `<section class="admin-dashboard-pair"><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph green">▣</span>Recent Transactions</h2><a class="admin-panel-link" href="#payments" data-route="payments">View Ledger →</a></header>${recent}</article><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph purple">⚑</span>Recent Inquiries &amp; CRM Leads</h2><a class="admin-panel-link" href="#leads" data-route="leads">Go to CRM →</a></header>${data.leads.length ? data.leads.slice(0, 3).map((lead) => `<div class="admin-transaction">${personCell(lead.name, `${lead.course || "Course not selected"} · ${lead.status}`)}<a href="#leads" data-route="leads">View</a></div>`).join("") : `<div class="admin-empty admin-inquiry-empty"><span>♧</span>No leads or inquiries yet</div>`}</article></section>
    <section class="admin-predictive-panel"><header><div><h2><span>⌁</span>Predictive Insights</h2><p>Preview only · no forecasting service is connected</p></div><button type="button" data-action="refresh-insights">↻ Refresh</button></header><div class="admin-predictive-grid"><article><b>—</b><span>NOV 2026</span></article><article><b>—</b><span>DEC 2026</span></article><article><b>—</b><span>JAN 2027</span></article><article><span>▨ PEAK MONTHS</span><b>Not calculated</b></article><article><span>⚠ DROPOUT RISK</span><b>Not calculated</b></article><article><span>▥ TREND</span><b class="admin-trend-tag">No forecast data</b></article></div></section>
    <section class="admin-revenue-layout"><article class="admin-dashboard-panel admin-revenue-panel"><header><h2><span class="panel-glyph green">⌁</span>Revenue — Last 6 Months</h2><div class="admin-collection-summary"><div class="admin-collection-ring"><b>${collection}%<small>COLLECTED</small></b></div><div><b>Fee Collection</b><small>${money(outstanding)} pending</small></div></div></header><div class="admin-revenue-bars">${revenueBars}</div><small class="admin-chart-caption">Monthly revenue is calculated from saved demo payments.</small></article></section>
    <section class="admin-dashboard-pair admin-birthday-pair"><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph pink">♨</span>Today's Student Birthdays</h2><small>19 October 2026</small></header><div class="admin-empty"><span>♨</span>No student birthdays today</div></article><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph">♨</span>Today's Staff Birthdays</h2><small>19 October 2026</small></header><div class="admin-empty"><span>♨</span>No staff birthdays today</div></article></section>
    <section class="admin-dashboard-pair admin-secondary-pair"><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph purple">▤</span>Upcoming Exams</h2><a class="admin-panel-link" href="#exams" data-route="exams">View all →</a></header><div class="admin-empty">${data.exams.filter((item) => item.date >= today).length ? `${data.exams.filter((item) => item.date >= today).length} exam(s) scheduled` : "No upcoming exams"}</div></article><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph red">⚠</span>At-Risk Students</h2><a class="admin-panel-link" href="#students" data-route="students">View all →</a></header><div class="admin-empty admin-all-clear"><span>♧</span><b>${data.students.filter((item) => Number(item.attendance || 0) < 75).length ? "Review students with low attendance" : "All students on track!"}</b></div></article></section>
    <section class="admin-dashboard-pair admin-secondary-pair"><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph orange">♛</span>Top Performers</h2><a class="admin-panel-link" href="#reports" data-route="reports">View all →</a></header>${data.students.length ? `<div class="admin-performer"><span>🥇</span><i>${esc(data.students[0].name.slice(0, 1))}</i><div><b>${esc(data.students[0].name)}</b><small>${esc(batch(data.students[0].batchId)?.name || "No batch")}</small></div><strong>${attendanceRate(data.students[0].id)}%</strong></div>` : `<div class="admin-empty">No student results yet</div>`}</article><article class="admin-dashboard-panel"><header><h2><span class="panel-glyph cyan">▣</span>Active Homework</h2><a class="admin-panel-link" href="#homework" data-route="homework">View all →</a></header><div class="admin-empty">${data.homework.length ? `${data.homework.length} assignment(s) in the local demo` : "No active homework"}</div></article></section>`;
  }

  function coursesPage() {
    const rows = data.courses.map((item) => `<tr data-filter-row><td><b>${esc(item.name)}</b><small class="table-subtext">${esc(item.description || "")}</small></td><td>${esc(item.duration || "—")}</td><td>${data.batches.filter((entry) => entry.courseId === item.id).length}</td><td><span class="tag">${esc(item.status)}</span></td><td>${actionLink("View batches", "batches")}</td></tr>`);
    return `${pageHeading("Courses / Programs", "Create programs and connect them to batches.", button("＋ Add Course", "courses/new"))}${table("Courses", ["Program", "Duration", "Batches", "Status", "Actions"], rows)}`;
  }
  function courseForm() { return formPage("Add Course / Program", "Add a local program record. No external service is used.", "course", section("Program information", "Course options become available when creating a batch or admitting a student.", field("Course name", "name", "text", { required: true }) + field("Duration", "duration", "text", { placeholder: "e.g. 2 years" }) + field("Status", "status", "select", { choices: [["Active", "Active"], ["Archived", "Archived"]], value: "Active" }) + field("Description", "description", "textarea", { wide: true }))); }
  function batchesPage() {
    const rows = data.batches.map((item) => `<tr data-filter-row><td><b>${esc(item.name)}</b></td><td>${esc(course(item.courseId)?.name || "—")}</td><td>${esc(staff(item.teacherId)?.name || "Unassigned")}</td><td>${data.students.filter((entry) => entry.batchId === item.id).length}</td><td>${esc(item.schedule || "—")}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`);
    return `${pageHeading("Batches", "Group students under a course, academic year and assigned teacher.", button("＋ Create Batch", "batches/new"))}${table("Batches", ["Batch", "Course", "Teacher", "Students", "Schedule", "Status"], rows)}`;
  }
  function batchForm() { return formPage("Create New Batch", "Select existing course, academic year and active teaching staff.", "batch", section("Batch details", "Only active teacher profiles are selectable.", field("Batch name", "name", "text", { required: true }) + field("Course / program", "courseId", "select", { required: true, choices: data.courses.map((item) => [item.id, item.name]) }) + field("Academic year", "academicYearId", "select", { required: true, choices: data.academicYears.map((item) => [item.id, item.name]) }) + field("Teacher", "teacherId", "select", { choices: [["", "Unassigned"], ...activeTeachers().map((item) => [item.id, item.name])] }) + field("Weekly schedule", "schedule", "text", { placeholder: "e.g. Monday, Wednesday, Friday" }) + field("Status", "status", "select", { value: "Active", choices: [["Active", "Active"], ["Archived", "Archived"]] }))); }

  function studentsPage() {
    const riskFor = (item) => item.risk || (attendanceRate(item.id) < 60 ? "High" : attendanceRate(item.id) < 75 ? "Medium" : "Low");
    const feesFor = (item) => studentFees(item.id).reduce((sum, entry) => sum + balance(entry.id), 0);
    const statuses = data.students.map((item) => String(item.status || "Active").toLowerCase());
    const current = new Date();
    const newThisMonth = data.students.filter((item) => { const date = new Date(`${item.admissionDate || ""}T00:00:00`); return !Number.isNaN(date.valueOf()) && date.getMonth() === current.getMonth() && date.getFullYear() === current.getFullYear(); }).length;
    const stats = [
      ["Total", data.students.length, "students", "blue", "people"],
      ["Active", statuses.filter((status) => status === "active").length, "active", "green", "active"],
      ["At risk", data.students.filter((item) => riskFor(item).toLowerCase() !== "low").length, "at risk", "red", "risk"],
      ["Dropped", statuses.filter((status) => status === "dropped").length, "dropped", "gray", "drop"],
      ["New (Month)", newThisMonth, "new this month", "cyan", "new"]
    ].map(([label, value, sub, color, icon]) => `<article class="students-metric ${color}"><span class="students-metric-icon">${studentActionIcon(icon)}</span><b>${value}</b><small>${label}</small></article>`).join("");
    const options = (items, label, valueKey = "id") => `<option value="">${label}</option>${items.map((item) => `<option value="${esc(item[valueKey])}">${esc(item.name)}</option>`).join("")}`;
    const controls = `<div class="students-filters"><label class="students-search"><span>${studentActionIcon("search")}</span><input id="students-search" type="search" placeholder="Search name, email, admission no..." aria-label="Search students" /></label><select id="students-batch" aria-label="Filter by batch">${options(data.batches, "All Batches")}</select><select id="students-status" aria-label="Filter by status"><option value="">All Status</option><option>Active</option><option>Inactive</option><option>Dropped</option></select><select id="students-sort" aria-label="Sort students"><option value="admission-asc">Admission No (A-Z)</option><option value="admission-desc">Admission No (Z-A)</option><option value="name-asc">Name (A-Z)</option><option value="name-desc">Name (Z-A)</option></select><button class="primary-action" id="students-filter">${studentActionIcon("filter")} Filter</button><button class="secondary-action" id="students-clear">Clear</button></div>`;
    let sorted = [...data.students];
    const sortValue = root.querySelector("#students-sort")?.value || "admission-asc";
    const admissionNo = (item, index) => item.admissionNo || `ADM-${(item.admissionDate || today).slice(0, 4)}-${String(index + 1).padStart(4, "0")}`;
    sorted.sort((a, b) => {
      const ai = data.students.indexOf(a), bi = data.students.indexOf(b);
      const left = sortValue.startsWith("name") ? a.name.toLowerCase() : admissionNo(a, ai);
      const right = sortValue.startsWith("name") ? b.name.toLowerCase() : admissionNo(b, bi);
      return left.localeCompare(right) * (sortValue.endsWith("desc") ? -1 : 1);
    });
    const rows = sorted.map((item) => {
      const admission = admissionNo(item, data.students.indexOf(item));
      const rate = attendanceRate(item.id), due = feesFor(item), risk = riskFor(item), selectedBatch = batch(item.batchId), dueSoon = studentFees(item.id).some((entry) => balance(entry.id) > 0 && entry.dueDate >= today);
      const searchText = `${item.name} ${item.email || ""} ${item.roll || ""} ${admission} ${selectedBatch?.name || ""}`.toLowerCase();
      return `<tr data-student-row data-filter-row data-batch="${esc(item.batchId || "")}" data-status="${esc(item.status || "Active")}" data-search="${esc(searchText)}" data-admission="${esc(admission)}" data-name="${esc(item.name.toLowerCase())}"><td><div class="students-person"><i>${item.photoData ? `<img src="${esc(item.photoData)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : esc((item.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</i><span><b>${esc(item.name)}</b><small>${esc(item.email || item.phone || item.roll || "Student")}</small></span></div></td><td><span class="admission-badge">${esc(admission)}</span></td><td><b>${esc(selectedBatch?.name || "Unassigned")}</b><small class="students-subtext">${esc(course(item.courseId)?.name || "—")}</small></td><td>${esc(item.subjects?.join(", ") || "—")}</td><td><div class="attendance-cell"><span><i style="width:${Math.max(0, Math.min(100, rate))}%"></i></span><b>${rate}%</b></div></td><td><b class="fee-value">${money(due)}</b><small class="fee-state ${due === 0 ? "paid" : dueSoon ? "upcoming" : "due"}">${due === 0 ? "PAID" : dueSoon ? "UPCOMING" : "DUE"}</small></td><td><span class="risk-pill ${risk.toLowerCase()}"><i></i>${esc(risk)}</span></td><td><span class="student-status ${String(item.status || "Active").toLowerCase()}">${esc(item.status || "Active")}</span></td><td><div class="students-row-actions"><button aria-label="View ${esc(item.name)} profile" title="View profile" data-route="student/${esc(item.id)}">${studentActionIcon("view")}</button><button aria-label="Edit ${esc(item.name)}" title="Edit student" data-student-action="edit" data-id="${esc(item.id)}">${studentActionIcon("edit")}</button><button class="transfer" aria-label="Transfer or update ${esc(item.name)}" title="Transfer / status" data-student-action="transfer" data-id="${esc(item.id)}">${studentActionIcon("transfer")}</button></div></td></tr>`;
    }).join("");
    const visibleCount = data.students.length;
    const actionButtons = `<div class="students-actions"><button class="risk-action" data-student-action="risk">${studentActionIcon("risk")} AI Risk Scores</button><button class="secondary-action" data-student-action="bulk">${studentActionIcon("edit")} Bulk Update</button><button class="secondary-action" data-student-action="import">${studentActionIcon("upload")} Import</button><button class="secondary-action" data-export>${studentActionIcon("download")} Export</button><a class="primary-action" href="#students/new" data-route="students/new">${studentActionIcon("new")} Admit Student</a></div>`;
    return `<section class="students-page"><header class="students-heading"><div><h1>Students</h1><p>Manage all enrolled students across batches</p></div>${actionButtons}</header><div class="students-metrics">${stats}</div>${controls}<section class="students-table-card"><div class="students-table-scroll"><table class="students-table"><thead><tr><th>Student</th><th>Admission No.</th><th>Batch</th><th>Subjects</th><th>Attendance</th><th>Fees</th><th>Risk</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || `<tr><td colspan="9" class="students-empty">No students found. Admit a student to get started.</td></tr>`}</tbody></table></div><div class="students-record-count">${visibleCount} ${visibleCount === 1 ? "record" : "records"}</div></section></section>`;
  }
  function studentActionIcon(name) {
    const paths = { people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm12-9a3 3 0 1 0-1-5.8M17 14a5 5 0 0 1 4 5v1h-3"/>', active: '<circle cx="10" cy="8" r="3"/><path d="M4 20v-1a6 6 0 0 1 12 0v1zm13-9 2 2 4-4"/>', risk: '<path d="m12 3 10 18H2z"/><path d="M12 9v5m0 3h.01"/>', drop: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm14-10h5"/>', new: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm14-6h6m-3-3v6"/>', search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>', filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>', download: '<path d="M12 4v12m-4-4 4 4 4-4M4 20h16"/>', view: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>', edit: '<path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4M3 4h7"/>', transfer: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm14-10h5m-3-2 3 2-3 2"/>', 'new': '<path d="M12 5v14M5 12h14"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.new}</svg>`;
  }
  function handleStudentAction(action, id = "") {
    const item = student(id);
    if (action === "risk") {
      const high = data.students.filter((entry) => attendanceRate(entry.id) < 60).length;
      const medium = data.students.filter((entry) => attendanceRate(entry.id) >= 60 && attendanceRate(entry.id) < 75).length;
      const low = data.students.length - high - medium;
      showDialog("AI Risk Scores", `<div class="student-action-summary"><p>Risk levels are calculated locally from attendance in this demo. No AI provider is connected.</p><div><b>${high}</b><small>High risk</small></div><div><b>${medium}</b><small>Medium risk</small></div><div><b>${low}</b><small>Low risk</small></div></div><p class="student-action-hint">High: attendance below 60% · Medium: 60–74% · Low: 75% or above.</p>`, `<button class="primary-action" data-action="close-dialog">Done</button>`);
      return;
    }
    if (action === "edit" && item) {
      const status = item.status || "Active";
      showDialog("Edit Student", `<form data-admin-form="student-edit" data-student-id="${esc(item.id)}" novalidate><label class="field-label">Full name<input class="form-control" name="name" required value="${esc(item.name)}" /></label><label class="field-label">Email<input class="form-control" type="email" name="email" value="${esc(item.email || "")}" /></label><label class="field-label">Phone<input class="form-control" name="phone" value="${esc(item.phone || "")}" /></label><label class="field-label">Status<select class="form-control" name="status"><option ${status === "Active" ? "selected" : ""}>Active</option><option ${status === "Inactive" ? "selected" : ""}>Inactive</option><option ${status === "Dropped" ? "selected" : ""}>Dropped</option></select></label><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button class="primary-action" type="submit">Save changes</button></div></form>`);
      return;
    }
    if (action === "transfer" && item) {
      const batchOptions = `<option value="">Unassigned</option>${data.batches.map((entry) => `<option value="${esc(entry.id)}" ${entry.id === item.batchId ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}`;
      const status = item.status || "Active";
      showDialog("Transfer / Update Student", `<form data-admin-form="student-action" data-student-id="${esc(item.id)}" novalidate><label class="field-label">Batch<select class="form-control" name="batchId">${batchOptions}</select></label><label class="field-label">Student status<select class="form-control" name="status"><option ${status === "Active" ? "selected" : ""}>Active</option><option ${status === "Inactive" ? "selected" : ""}>Inactive</option><option ${status === "Dropped" ? "selected" : ""}>Dropped</option></select></label><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button class="primary-action" type="submit">Save update</button></div></form>`);
      return;
    }
    if (action === "bulk") {
      showDialog("Bulk Update Students", `<p>Apply a status to every student, or only students in one batch.</p><form data-admin-form="student-bulk" novalidate><label class="field-label">Batch<select class="form-control" name="batchId"><option value="">All batches</option>${data.batches.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("")}</select></label><label class="field-label">Set status<select class="form-control" name="status" required><option value="">Select status</option><option>Active</option><option>Inactive</option><option>Dropped</option></select></label><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button class="primary-action" type="submit">Update students</button></div></form>`);
      return;
    }
    if (action === "import") {
      pendingStudentImport = [];
      showDialog("Import Students", `<p>Select a CSV file with columns <b>name, email, phone, course, batch</b>. This browser-only preview adds valid records to local demo data; no file is uploaded.</p><form data-admin-form="student-import" novalidate><label class="field-label">CSV file<input class="form-control" type="file" name="csvFile" accept=".csv,text/csv" required /></label><div class="student-import-preview" aria-live="polite">Choose a CSV file to preview rows.</div><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button class="primary-action" type="submit">Import valid rows</button></div></form>`);
      dialogBody.querySelector('input[name="csvFile"]')?.addEventListener("change", previewStudentImport);
    }
  }
  let pendingStudentImport = [];
  function parseCsvRow(line) {
    const cells = []; let value = "", quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === "," && !quoted) { cells.push(value.trim()); value = ""; }
      else value += character;
    }
    cells.push(value.trim()); return cells;
  }
  function previewStudentImport(event) {
    const file = event.target.files?.[0]; if (!file) return;
    file.text().then((text) => {
      const lines = text.split(/\r?\n/).map(parseCsvRow).filter((line) => line.some(Boolean));
      const headers = (lines.shift() || []).map((value) => value.toLowerCase());
      pendingStudentImport = lines.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]))).filter((row) => row.name && row.course && row.batch);
      const preview = dialogBody.querySelector(".student-import-preview");
      if (preview) preview.textContent = `${pendingStudentImport.length} valid row(s) found. Rows without name, course, or batch will be skipped.`;
    }).catch(() => { pendingStudentImport = []; const preview = dialogBody.querySelector(".student-import-preview"); if (preview) preview.textContent = "The selected CSV could not be read."; });
  }
  function studentForm() {
    photoData = "";
    const batchOptions = data.courses.map((courseItem) => {
      const batches = data.batches.filter((entry) => entry.courseId === courseItem.id);
      return batches.length ? `<optgroup label="${esc(courseItem.name)}">${batches.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("")}</optgroup>` : "";
    }).join("");
    const subjects = studentSubjectOptions();
    const req = '<em>*</em>';
    const label = (text, required = false) => `<span>${text}${required ? ` ${req}` : ""}</span>`;
    const phone = (title, name, required = false) => `<label class="admit-field">${label(title, required)}<span class="admit-phone"><span>91</span><input data-admission-field name="${name}" type="tel" inputmode="numeric" maxlength="10" placeholder="Mobile number" ${required ? "required" : ""} /></span><input type="hidden" name="${name}CountryCode" value="91"/><small class="admit-error-text"></small></label>`;
    const admission = `<label class="admit-field">${label("Admission Number")}<span class="admit-admission-number"><span>${studentFormIcon("list")}</span><input id="student-admission-number" data-admission-field name="admissionNo" required value="${esc(nextAdmissionNumber())}" /><button type="button" data-student-regenerate aria-label="Regenerate admission number">${studentFormIcon("refresh")}</button></span><small>Leave as suggested or override. Configure the format in <a href="#settings" data-route="settings">Settings → Academic</a>.</small><small class="admit-error-text"></small></label>`;
    const personal = `<section class="admit-card"><header>Personal Information</header><div class="admit-card-body"><div class="admit-fields">${admission}<label class="admit-field">${label("Full Name", true)}<input data-admission-field name="name" required placeholder="Student full name" /><small class="admit-error-text"></small></label><label class="admit-field">${label("Email Address", true)}<input data-admission-field name="email" type="email" required placeholder="student@example.com" /><small class="admit-error-text"></small></label>${phone("Phone Number", "phone", true)}<label class="admit-field">${label("Date of Birth")}<input data-admission-field name="dateOfBirth" type="date" /></label><label class="admit-field">${label("Gender")}<select data-admission-field name="gender"><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></label><label class="admit-field">${label("Blood Group")}<select data-admission-field name="bloodGroup"><option value="">Select</option>${["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((value) => `<option>${value}</option>`).join("")}</select></label><label class="admit-field admit-wide">${label("Address")}<textarea data-admission-field name="address" placeholder="Full address"></textarea></label></div></div></section>`;
    const guardian = `<section class="admit-card"><header>Parent / Guardian Details</header><div class="admit-card-body"><div class="admit-fields"><label class="admit-field">${label("Father's Name", true)}<input data-admission-field name="fatherName" required placeholder="Father's full name" /><small class="admit-error-text"></small></label><label class="admit-field">${label("Mother's Name")}<input data-admission-field name="motherName" placeholder="Mother's full name" /></label>${phone("Guardian Phone", "guardianPhone")}<label class="admit-field">${label("Parent Name (for login)")}<input data-admission-field name="parentName" placeholder="Parent/Guardian name" /></label><label class="admit-field">${label("Parent Email (creates login)")}<input data-admission-field name="parentEmail" type="email" placeholder="parent@example.com" /><small class="admit-error-text"></small></label>${phone("Parent Phone", "parentPhone")}</div></div></section>`;
    const academic = `<section class="admit-card"><header>Academic Details</header><div class="admit-card-body"><label class="admit-field">${label("Course → Batch", true)}<select data-admission-field name="batchId" id="student-batch" required><option value="">Select a batch...</option>${batchOptions || data.batches.map((entry) => `<option value="${esc(entry.id)}">${esc(entry.name)}</option>`).join("")}</select><small class="admit-error-text"></small></label><label class="admit-field admit-subject-field">${label("Assign Subjects")} <small>(multiple)</small><span class="subject-picker"><input id="student-subject-search" type="search" placeholder="Search & select..." aria-label="Search subjects" /><span id="student-subject-options">${subjects}</span></span><small>Hold Ctrl (Windows) or Cmd (Mac) to select multiple subjects.</small></label><div class="admit-credentials"><b>${studentFormIcon("info")} Default login credentials:</b><span>Student: <code>JeemStudent@12345</code></span><span>Parent: <code>JeemParent@12345</code></span><span>(Changeable on first login)</span></div></div></section>`;
    const photo = `<section class="admit-card"><header>Photo</header><div class="admit-photo-body"><div class="admit-photo-preview"><img id="student-photo-preview" alt="Student photo preview" hidden />${studentFormIcon("user")}</div><video id="student-camera-video" autoplay playsinline hidden></video><div class="admit-photo-buttons"><label class="admit-outline-button">${studentFormIcon("upload")} Upload Photo<input class="sr-only" id="student-photo" type="file" accept="image/jpeg,image/png,image/webp" /></label><button type="button" class="admit-outline-button blue" data-student-camera>${studentFormIcon("camera")} Take Photo</button><button type="button" class="admit-outline-button blue" data-capture-photo hidden>Capture</button></div><small id="photo-status">JPG, PNG, WebP up to 2MB</small></div></section>`;
    return `<section class="admit-page"><header class="admit-heading"><a class="admit-back" href="#students" data-route="students" aria-label="Back to students">${studentFormIcon("back")}</a><div><h1>Admit New Student</h1><p>Fill in the student details below</p></div></header><form data-admin-form="student" class="admit-form" novalidate><div class="admit-columns"><div class="admit-left">${personal}${guardian}</div><aside class="admit-right">${academic}${photo}<div class="admit-submit-actions"><div class="admin-form-error" aria-live="polite"></div><button class="primary-action" type="submit">${studentFormIcon("new")} Admit Student</button><a class="secondary-action" href="#students" data-route="students">Cancel</a></div></aside></div></form></section>`;
  }
  function studentFormIcon(name) {
    const paths = { list: '<path d="M8 5h12M8 12h12M8 19h12"/><path d="M4 5h.01M4 12h.01M4 19h.01"/>', refresh: '<path d="M20 11a8 8 0 0 0-14-5L4 8"/><path d="M4 4v4h4m-4 5a8 8 0 0 0 14 5l2-2m0 4v-4h-4"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>', user: '<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>', upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>', camera: '<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2z"/><circle cx="12" cy="13" r="3"/>', back: '<path d="m15 18-6-6 6-6M9 12h12"/>', new: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm14-6h6m-3-3v6"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  }
  function nextAdmissionNumber() {
    const year = today.slice(0, 4);
    const numbers = data.students.map((item) => Number(String(item.admissionNo || "").match(new RegExp(`^ADM-${year}-(\\d+)$`))?.[1] || 0));
    return `ADM-${year}-${String(Math.max(numbers.length ? Math.max(...numbers) : 0, data.students.length) + 1).padStart(4, "0")}`;
  }
  function studentSubjectOptions(batchId = "") {
    const selectedBatch = batch(batchId), courseRecord = course(selectedBatch?.courseId);
    const all = Array.isArray(data.subjects) ? data.subjects : [];
    const names = selectedBatch?.subjectNames || courseRecord?.subjectNames || (/JEE|NEET/i.test(courseRecord?.name || "") ? ["Physics", "Chemistry", "Mathematics"] : []);
    const subjects = all.length ? all : names.map((name) => ({ id: name, name }));
    const assigned = selectedBatch?.subjectIds || courseRecord?.subjectIds;
    const available = subjects.filter((item) => !assigned || assigned.includes(item.id) || assigned.includes(item.name));
    if (!available.length) return `<small class="subject-none">No subjects are configured for this batch yet.</small>`;
    return available.map((item) => `<label><input type="checkbox" name="subjects" value="${esc(item.name)}" /><span>${esc(item.name)}</span></label>`).join("");
  }
  function updateBatchOptions(event) {
    const selected = event.target.value; const select = root.querySelector("#student-batch"); if (!select) return;
    const options = data.batches.filter((item) => item.courseId === selected);
    select.innerHTML = options.length ? options.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("") : `<option value="">No batches for this course</option>`;
    select.disabled = !options.length;
  }
  function previewPhoto(event) {
    const file = event.target.files?.[0]; const preview = root.querySelector("#student-photo-preview"); const status = root.querySelector("#photo-status");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) { status.textContent = "Choose a JPG, PNG, or WebP image up to 2MB."; event.target.value = ""; return; }
    if (photoPreview) URL.revokeObjectURL(photoPreview); photoPreview = URL.createObjectURL(file); preview.src = photoPreview; preview.hidden = false;
    compressStudentPhoto(file).then((value) => { photoData = value; status.textContent = `${file.name} · ready to save`; }).catch(() => { status.textContent = "This image could not be prepared."; });
  }
  function compressStudentPhoto(file) {
    return createImageBitmap(file).then((bitmap) => {
      const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      return canvas.toDataURL("image/jpeg", .76);
    });
  }
  async function startStudentCamera() {
    const video = root.querySelector("#student-camera-video");
    if (!navigator.mediaDevices?.getUserMedia) return toast("Camera access is not available in this browser.", true);
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      video.srcObject = cameraStream; video.hidden = false;
      root.querySelector("[data-capture-photo]").hidden = false;
      root.querySelector("#photo-status").textContent = "Camera ready. Capture when you are ready.";
    } catch { toast("Allow camera access to take a student photo.", true); }
  }
  function captureStudentPhoto() {
    const video = root.querySelector("#student-camera-video"), preview = root.querySelector("#student-photo-preview");
    if (!video?.videoWidth) return toast("Wait for the camera preview to load.", true);
    const canvas = document.createElement("canvas"); canvas.width = Math.min(600, video.videoWidth); canvas.height = Math.round(canvas.width * video.videoHeight / video.videoWidth);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height); photoData = canvas.toDataURL("image/jpeg", .76);
    preview.src = photoData; preview.hidden = false; root.querySelector("#photo-status").textContent = "Camera photo ready to save.";
    cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null; video.hidden = true; root.querySelector("[data-capture-photo]").hidden = true;
  }
  function updateStudentSubjects(event) {
    const slot = root.querySelector("#student-subject-options"); if (slot) slot.innerHTML = studentSubjectOptions(event.target.value);
  }
  function filterStudentSubjects(event) {
    const term = event.target.value.trim().toLowerCase();
    root.querySelectorAll("#student-subject-options label").forEach((item) => { item.hidden = !item.textContent.toLowerCase().includes(term); });
  }
  function studentProfile(id) {
    const item = student(id); if (!item) return `${pageHeading("Student profile", "Record not found.", button("← Students", "students"))}${empty("Student not found", "The selected demo record may have been removed.")}`;
    const fees = studentFees(item.id); const outstanding = fees.reduce((sum, itemFee) => sum + balance(itemFee.id), 0);
    return `${pageHeading(item.name, `${item.roll} · ${item.status}`, `<button class="primary-action" data-open-form="fees/assign?student=${item.id}">＋ Assign Fee</button>`)}<div class="student-profile-grid"><section class="panel admin-profile-card"><div class="admin-profile-head">${personCell(item.name, item.email || item.phone || "Student")}</div><div class="admin-detail-grid"><div><small>Course</small><b>${esc(course(item.courseId)?.name || "Unassigned")}</b></div><div><small>Batch</small><b>${esc(batch(item.batchId)?.name || "Unassigned")}</b></div><div><small>Academic year</small><b>${esc(data.academicYears.find((year) => year.id === item.academicYearId)?.name || "Unassigned")}</b></div><div><small>Admission date</small><b>${dateLabel(item.admissionDate)}</b></div><div><small>Parent / guardian</small><b>${esc(item.parentName || "Not provided")}</b></div><div><small>Attendance</small><b>${Number(item.attendance || 0)}%</b></div></div></section><section class="panel admin-profile-card"><div class="panel-head"><h2>Fee Summary</h2><span class="tag warning">${money(outstanding)} due</span></div><div class="panel-body">${fees.length ? fees.map((itemFee) => `<div class="admin-fee-row"><div><b>${esc(itemFee.title)}</b><small>${itemFee.installments} installments · due ${dateLabel(itemFee.dueDate)}</small></div><strong>${money(balance(itemFee.id))}</strong><button class="mini-btn" data-dialog-action="collect" data-id="${itemFee.id}" ${balance(itemFee.id) === 0 ? "disabled" : ""}>Collect</button></div>`).join("") : empty("No fee assigned", "Assign a fee to track this student's balance.", `<a class="primary-action" href="#fees/assign?student=${item.id}" data-route="fees/assign">Assign Fee</a>`)}</div></section></div><section class="panel admin-table-panel"><div class="admin-table-toolbar"><div><b>Payment history</b><small>Recorded demo payments for ${esc(item.name)}</small></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Fee</th><th>Amount</th><th>Method</th><th>Receipt</th></tr></thead><tbody>${data.payments.filter((payment) => payment.studentId === item.id).map((payment) => `<tr><td>${dateLabel(payment.date)}</td><td>${esc(fee(payment.feeId)?.title || "Fee")}</td><td>${money(payment.amount)}</td><td>${esc(payment.method)}</td><td><button class="mini-btn" data-dialog-action="receipt" data-id="${payment.id}">${esc(payment.receiptNo)}</button></td></tr>`).join("") || `<tr><td colspan="5">${empty("No payments yet", "Recorded payments will appear here.")}</td></tr>`}</tbody></table></div></section>`;
  }
  function feeForm() {
    const studentId = new URLSearchParams(location.hash.split("?")[1] || "").get("student") || "";
    const students = data.students.map((item) => [item.id, item.name]);
    return formPage("Assign Fee to Student", "Create a fee balance. This does not charge or collect money.", "fee", section("Fee details", "Payments can later be recorded against this fee in the local demo.", field("Student", "studentId", "select", { required: true, value: studentId, choices: students }) + field("Fee title", "title", "text", { required: true, value: "Tuition Fee" }) + field("Total amount (₹)", "total", "number", { required: true, min: "1", step: "1" }) + field("Installments", "installments", "number", { required: true, min: "1", step: "1", value: "1" }) + field("First due date", "dueDate", "date", { required: true, value: today }) + field("Notes", "note", "textarea", { wide: true })));
  }
  function billingPage() {
    const total = data.fees.reduce((sum, item) => sum + Number(item.total), 0); const collected = data.payments.reduce((sum, item) => sum + Number(item.amount), 0); const due = data.fees.reduce((sum, item) => sum + balance(item.id), 0);
    const rows = data.fees.map((item) => `<tr data-filter-row><td>${personCell(student(item.studentId)?.name || "Unknown student")}</td><td>${esc(item.title)}</td><td>${money(item.total)}</td><td>${money(paid(item.id))}</td><td>${money(balance(item.id))}</td><td>${dateLabel(item.dueDate)}</td><td><button class="mini-btn" data-dialog-action="collect" data-id="${item.id}" ${balance(item.id) === 0 ? "disabled" : ""}>Collect payment</button></td></tr>`);
    return `${pageHeading("Smart Billing Hub", "Balances are calculated from fee assignments and recorded demo payments.", button("＋ Assign Fee", "fees/assign"))}<div class="summary-row">${statCard("Fees assigned", money(total))}${statCard("Collected", money(collected), "green")}${statCard("Outstanding", money(due), "orange")}</div>${table("Fee ledger", ["Student", "Fee", "Total", "Paid", "Balance", "Due date", "Action"], rows, `<a class="secondary-action" href="#payments" data-route="payments">Payment history</a>`)}`;
  }
  function paymentsPage() {
    const rows = [...data.payments].sort((a, b) => b.date.localeCompare(a.date)).map((payment) => `<tr data-filter-row><td>${dateLabel(payment.date)}</td><td>${personCell(student(payment.studentId)?.name || "Unknown student")}</td><td>${esc(fee(payment.feeId)?.title || "Fee")}</td><td>${money(payment.amount)}</td><td>${esc(payment.method)}</td><td>${esc(payment.receiptNo)}</td><td><button class="mini-btn" data-dialog-action="receipt" data-id="${payment.id}">View receipt</button></td></tr>`);
    return `${pageHeading("Payment History", "Local demo records only. No real payment processing occurs.", button("＋ Assign Fee", "fees/assign"))}${table("Payments", ["Date", "Student", "Fee", "Amount", "Method", "Receipt", "Actions"], rows)}`;
  }
  function showPaymentDialog(feeId) {
    const item = fee(feeId); if (!item) return toast("Fee record not found.", true);
    const due = balance(feeId); const learner = student(item.studentId);
    showDialog("Collect Payment", `${personCell(learner?.name || "Student", item.title)}<div class="admin-payment-balance"><span>Outstanding balance</span><b>${money(due)}</b></div><form data-admin-form="payment" data-fee-id="${esc(feeId)}" novalidate>${field("Amount (₹)", "amount", "number", { required: true, min: "1", max: String(due), step: "1" })}${field("Payment method", "method", "select", { required: true, value: "Cash", choices: [["Cash", "Cash"], ["UPI (demo)", "UPI (demo)"], ["Bank transfer (demo)", "Bank transfer (demo)"]] })}${field("Payment date", "date", "date", { required: true, value: today })}${field("Note", "note", "text", { placeholder: "Optional" })}<div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button type="submit" class="primary-action">Record demo payment</button></div></form>`);
  }
  function showReceipt(paymentId) {
    const payment = receiptFor(paymentId); if (!payment) return toast("Receipt record not found.", true);
    const learner = student(payment.studentId); const feeRecord = fee(payment.feeId);
    showDialog("Payment Receipt · Local Demo", `<article class="print-receipt"><div class="receipt-brand">${logo()}<span class="receipt-demo-tag">DEMO RECEIPT · NO REAL PAYMENT</span></div><hr/><div class="receipt-title"><h3>Payment receipt</h3><b>${esc(payment.receiptNo)}</b></div><div class="receipt-details"><div><small>Received from</small><strong>${esc(learner?.name || "Student")}</strong></div><div><small>Institute</small><strong>JEE Mentor</strong></div><div><small>Fee</small><strong>${esc(feeRecord?.title || "Fee")}</strong></div><div><small>Payment date</small><strong>${dateLabel(payment.date)}</strong></div><div><small>Method</small><strong>${esc(payment.method)}</strong></div><div><small>Note</small><strong>${esc(payment.note || "—")}</strong></div></div><div class="receipt-total"><span>Amount recorded</span><b>${money(payment.amount)}</b></div><p>This receipt documents a local prototype entry. No money was charged or transferred.</p></article><div class="dialog-actions no-print"><button class="secondary-action" data-action="close-dialog">Close</button><button class="primary-action" data-action="print">Print receipt</button></div>`);
  }

  function academicYearsPage() { const rows = data.academicYears.map((item) => `<tr data-filter-row><td><b>${esc(item.name)}</b></td><td>${dateLabel(item.startDate)}</td><td>${dateLabel(item.endDate)}</td><td><span class="tag">${esc(item.status)}</span></td><td>${data.batches.filter((entry) => entry.academicYearId === item.id).length} batches</td></tr>`); return `${pageHeading("Academic Years", "Manage year labels used by courses, batches and student admissions.", button("＋ New Academic Year", "academic-years/new"))}${table("Academic years", ["Year", "Start date", "End date", "Status", "Records"], rows)}`; }
  function academicYearForm() { return formPage("Create Academic Year", "Year rollover and student promotion are not automated in this prototype.", "academic-year", section("Year details", "Dates must be valid and the end date must follow the start date.", field("Year name", "name", "text", { required: true, placeholder: "2027–28" }) + field("Start date", "startDate", "date", { required: true }) + field("End date", "endDate", "date", { required: true }) + field("Status", "status", "select", { value: "Active", choices: [["Active", "Active"], ["Planned", "Planned"], ["Archived", "Archived"]] }))); }
  function staffTypeOf(item) { const raw = String(item.staffType || item.role || "Teacher").trim(); return ["Teacher", "Admin", "Accountant", "Counselor", "Receptionist", "Librarian", "Other"].find((type) => new RegExp(`${type}$`, "i").test(raw)) || raw || "Teacher"; }
  function staffActive(item) { return String(item.status || "Active").toLowerCase() === "active"; }
  function activeTeachers() { return data.staff.filter((item) => staffActive(item) && /teacher/i.test(staffTypeOf(item))); }
  function staffInitials(name) { return String(name || "New Staff").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase(); }
  function staffIcon(name, className = "") { return `<span class="staff-icon ${className}">${navIcon(name)}</span>`; }
  function staffActions(item) { return `<div class="staff-card-actions"><button type="button" data-staff-action="view" data-id="${esc(item.id)}">${navIcon("eye")}<span>View</span></button><button type="button" data-staff-action="edit" data-id="${esc(item.id)}">${navIcon("pencil")}<span>Edit</span></button><a href="mailto:${esc(item.email || "")}" aria-label="Email ${esc(item.name)}">${navIcon("envelope")}</a></div>`; }
  function staffCard(item) {
    const assignments = item.subjectAssignments || [], salary = Number(item.monthlySalary || item.salary || 0);
    return `<article class="staff-card" data-staff-record data-name="${esc(`${item.name} ${item.email} ${item.employeeId} ${item.phone} ${assignments.map((entry) => entry.subject).join(" ")}`.toLowerCase())}" data-status="${staffActive(item) ? "active" : "inactive"}" data-role="${esc(staffTypeOf(item))}"><div class="staff-card-head">${item.photo ? `<img class="staff-avatar" src="${esc(item.photo)}" alt="${esc(item.name)}">` : `<span class="staff-avatar staff-avatar-fallback">${esc(staffInitials(item.name))}</span>`}<div class="staff-card-identity"><b>${esc(item.name)}</b><small title="${esc(item.email || "No email entered")}">${esc(item.email || "No email entered")}</small><div class="staff-badges"><span class="staff-status ${staffActive(item) ? "is-active" : "is-inactive"}"><i></i>${staffActive(item) ? "ACTIVE" : "INACTIVE"}</span><span class="staff-role-badge">${esc(staffTypeOf(item).toUpperCase())}</span></div></div><details class="staff-menu"><summary aria-label="Staff actions">⋮</summary><div><button type="button" data-staff-action="view" data-id="${esc(item.id)}">View</button><button type="button" data-staff-action="edit" data-id="${esc(item.id)}">Edit</button><button type="button" data-staff-action="toggle" data-id="${esc(item.id)}">${staffActive(item) ? "Deactivate" : "Activate"}</button><button type="button" data-staff-action="reset" data-id="${esc(item.id)}">Reset password</button><button type="button" data-staff-action="delete" data-id="${esc(item.id)}">Delete</button></div></details></div><div class="staff-info-grid"><div><small>EXPERIENCE</small><b>${esc(item.experienceYears || "—")}${item.experienceYears ? " yrs" : ""}</b></div><div><small>EMP ID</small><b>${esc(item.employeeId || "—")}</b></div><div><small>PHONE</small><b>${esc(item.phone || "—")}</b></div><div><small>JOINED</small><b>${esc(item.joiningDate ? dateLabel(item.joiningDate) : "—")}</b></div></div><div class="staff-subjects">${assignments.length ? assignments.map((entry) => `<span>${esc(entry.subject)}${entry.batchId ? ` · ${esc(batch(entry.batchId)?.name || "")}` : ""}</span>`).join("") : `<span class="staff-muted">No subjects assigned</span>`}</div>${staffActions(item)}<span class="staff-salary-hidden">${salary}</span></article>`;
  }
  function staffPage() {
    const roles = [...new Set(data.staff.map(staffTypeOf))].sort(), activeCount = data.staff.filter(staffActive).length, inactiveCount = data.staff.length - activeCount;
    const monthlyPayroll = data.staff.filter(staffActive).reduce((sum, item) => sum + Number(item.monthlySalary || item.salary || 0), 0);
    const todayClasses = Array.isArray(data.timetable) ? data.timetable.filter((item) => item.date === today && data.staff.some((person) => person.id === item.teacherId)).length : 0;
    let view = "grid"; try { view = sessionStorage.getItem("cs-admin-staff-view") || "grid"; } catch { /* Use the default view when session storage is unavailable. */ }
    const roleTabs = ["All", ...roles].map((role) => `<button type="button" class="staff-role-tab${role === "All" ? " active" : ""}" data-staff-role="${esc(role)}">${esc(role === "All" ? "All Staff" : role)} (${role === "All" ? data.staff.length : data.staff.filter((item) => staffTypeOf(item) === role).length})</button>`).join("");
    const records = data.staff.length ? `<div class="staff-card-grid">${data.staff.map((item) => staffCard(item)).join("")}</div><div class="staff-table-wrap"><table class="staff-table"><thead><tr><th>Staff member</th><th>Staff type</th><th>Employment</th><th>Monthly salary</th><th>Status</th><th>Actions</th></tr></thead><tbody>${data.staff.map((item) => `<tr data-staff-record data-name="${esc(`${item.name} ${item.email} ${item.employeeId} ${item.phone} ${(item.subjectAssignments || []).map((entry) => entry.subject).join(" ")}`.toLowerCase())}" data-status="${staffActive(item) ? "active" : "inactive"}" data-role="${esc(staffTypeOf(item))}"><td>${personCell(item.name, item.email)}</td><td>${esc(staffTypeOf(item))}</td><td>${esc(item.employmentType || "—")}</td><td>${money(item.monthlySalary || item.salary || 0)}</td><td>${esc(staffActive(item) ? "Active" : "Inactive")}</td><td><button type="button" data-staff-action="view" data-id="${esc(item.id)}">View</button> <button type="button" data-staff-action="edit" data-id="${esc(item.id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="staff-empty"><div>${navIcon("people")}</div><h2>No staff members yet</h2><p>Add your first staff profile to manage details, payroll settings and teaching assignments.</p><a class="primary-action" href="#staff-create" data-route="staff-create">${navIcon("user-plus")} Add New Staff</a></div>`;
    return `<section class="staff-list-page"><header class="staff-page-heading"><div><h1>Staff</h1><p>${data.staff.length} staff member${data.staff.length === 1 ? "" : "s"} · Manage your team</p></div><div class="staff-heading-actions"><a href="#work-shifts" data-route="work-shifts" class="staff-button">${navIcon("clock")}Work Shifts</a><details class="staff-import-menu"><summary class="staff-button">${navIcon("cloud-upload")}Import <span>⌄</span></summary><div><button type="button" data-staff-action="import">Import CSV</button><button type="button" data-staff-action="sample">Download sample CSV</button></div></details><a href="#staff-create" data-route="staff-create" class="staff-button staff-button-primary">${navIcon("user-plus")}Add New Staff</a></div></header><div class="staff-stat-row"><article class="staff-stat-card">${staffIcon("people", "staff-blue")}<div><small>TOTAL STAFF</small><strong>${data.staff.length}</strong><span>${activeCount} active</span></div></article><article class="staff-stat-card">${staffIcon("badge-check", "staff-green")}<div><small>ACTIVE</small><strong class="staff-value-green">${activeCount}</strong><span>${inactiveCount} inactive</span></div></article><article class="staff-stat-card">${staffIcon("calendar-dots", "staff-orange")}<div><small>TODAY'S CLASSES</small><strong class="staff-value-orange">${todayClasses}</strong><span>scheduled today</span></div></article><article class="staff-stat-card">${staffIcon("rupee", "staff-purple")}<div><small>TOTAL SALARY/MO</small><strong class="staff-value-blue">${money(monthlyPayroll)}</strong><span>payroll this month</span></div></article></div><section class="staff-toolbar"><label class="staff-search">${navIcon("search")}<input type="search" placeholder="Search by name, subject, employee ID..." aria-label="Search staff" data-staff-search></label><div class="staff-status-filters"><button class="active" type="button" data-staff-status="all">All (${data.staff.length})</button><button type="button" data-staff-status="active">Active (${activeCount})</button><button type="button" data-staff-status="inactive">Inactive (${inactiveCount})</button></div><div class="staff-view-toggle" aria-label="Staff layout"><button type="button" data-staff-view="grid" class="${view === "grid" ? "active" : ""}" aria-label="Grid view">${navIcon("dashboard")}</button><button type="button" data-staff-view="list" class="${view === "list" ? "active" : ""}" aria-label="List view">${navIcon("list-notebook")}</button></div></section><nav class="staff-role-tabs" aria-label="Filter by staff type">${roleTabs}</nav><div class="staff-records ${view === "list" ? "staff-list-view" : "staff-grid-view"}" data-staff-records>${records}</div><p class="staff-no-results" hidden>No staff matched your search.</p></section>`;
  }
  function staffField(label, name, type = "text", value = "", options = {}) { const input = `<input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" placeholder="${esc(options.placeholder || "")}" ${options.required ? "required" : ""} ${options.attrs || ""}>`, hint = options.hint || (name === "pfPercent" ? "Standard PF = 12%" : ""); return `<label class="staff-field${options.wide ? " staff-field-wide" : ""}"><span>${esc(label)}${options.required ? " <em>*</em>" : ""}</span>${type === "password" ? `<span class="staff-password-control">${input}<button type="button" data-staff-password-toggle aria-label="Show password">Show</button></span>` : input}${hint ? `<small class="staff-field-hint">${esc(hint)}</small>` : ""}<small class="staff-field-error" data-staff-error="${esc(name)}"></small></label>`; }
  function staffSelect(label, name, value, options, required = false) { const helper = name === "staffType" ? `Designation. Permissions are managed under <a href="#roles-permissions" data-route="roles-permissions">Roles &amp; Permissions</a>.` : ""; return `<label class="staff-field"><span>${esc(label)}${required ? " <em>*</em>" : ""}</span><select name="${esc(name)}" ${required ? "required" : ""}><option value="">Select ${esc(label.toLowerCase())}</option>${options.map(([id, text]) => `<option value="${esc(id)}" ${String(value) === String(id) ? "selected" : ""}>${esc(text)}</option>`).join("")}</select>${helper ? `<small class="staff-field-hint">${helper}</small>` : ""}<small class="staff-field-error" data-staff-error="${esc(name)}"></small></label>`; }
  function staffNextEmployeeId() { const used = new Set(data.staff.map((item) => String(item.employeeId || "").toLowerCase())); let index = 1; while (used.has(`emp-${String(index).padStart(3, "0")}`)) index += 1; return `EMP-${String(index).padStart(3, "0")}`; }
  function staffSubjects() { const subjects = [...new Set([...data.courses.flatMap((item) => item.subjects || []), ...data.students.flatMap((item) => item.subjects || []), ...data.questions.map((item) => item.subject), ...data.homework.map((item) => item.subject)].filter(Boolean))].sort(); return subjects.length ? subjects : ["Physics", "Chemistry", "Mathematics"]; }
  function staffForm(item = null) {
    staffPendingAssignments = (item?.subjectAssignments || []).map((entry) => ({ ...entry }));
    staffPhotoData = item?.photo || "";
    const editing = Boolean(item), employment = item?.employmentType || "Full-Time", salary = item?.monthlySalary ?? item?.salary ?? "", courses = data.courses.map((entry) => [entry.id, entry.name]), branches = Array.isArray(data.branches) ? data.branches : [], assignments = item?.subjectAssignments || [];
    const assignmentRows = assignments.map((entry, index) => `<span class="staff-assignment-chip">${esc(course(entry.courseId)?.name || "Course")} · ${esc(entry.subject)}${entry.batchId ? ` · ${esc(batch(entry.batchId)?.name || "Batch")}` : ""}<button type="button" data-staff-remove-assignment="${index}" aria-label="Remove ${esc(entry.subject)}">×</button></span>`).join("");
    const branchesMarkup = branches.length ? `<div class="staff-branch-options">${branches.map((entry) => `<label><input type="checkbox" name="branchIds" value="${esc(entry.id)}" ${(item?.branchIds || []).includes(entry.id) ? "checked" : ""}>${esc(entry.name)}</label>`).join("")}</div>` : `<div class="staff-branch-notice">No branches yet. <a href="#branches" data-route="branches">Create a branch</a> first.</div>`;
    const payrollMessage = { "Full-Time": "Payroll = Monthly Salary × (Present Days / Working Days). PF & TDS deducted on gross.", Contractual: "Payroll = Classes taught × Per-class rate. TDS deducted on gross.", "Part-Time / Hybrid": "Payroll = Base Salary + (Classes taught × Per-class rate), pro-rated by attendance.", "Hourly Basis": "Payroll = Approved working hours × Hourly rate. TDS deducted on gross." };
    const payField = (type, label, name, value, required = true) => `<div class="staff-pay-fields" data-staff-pay-fields="${esc(type)}" ${employment !== type ? "hidden" : ""}><div class="staff-form-grid">${staffField(label, name, "number", value, { required, attrs: 'min="0" step="1"' })}${type === "Full-Time" || type === "Part-Time / Hybrid" ? staffField("PF DEDUCTION (%)", "pfPercent", "number", item?.pfPercent ?? "12", { attrs: 'min="0" max="100" step=".1"' }) : ""}${type === "Part-Time / Hybrid" ? staffField("PER-CLASS RATE (₹)", "perClassRate", "number", item?.perClassRate || "", { required: true, attrs: 'min="0" step="1"' }) : ""}${staffField("TDS DEDUCTION (%)", "tdsPercent", "number", item?.tdsPercent ?? "0", { attrs: 'min="0" max="100" step=".1"' })}</div></div>`;
    const employmentFields = `${payField("Full-Time", "MONTHLY SALARY (₹)", "monthlySalary", salary)}${payField("Contractual", "PER-CLASS RATE (₹)", "perClassRate", item?.perClassRate || "")}${payField("Part-Time / Hybrid", "BASE SALARY (₹)", "baseSalary", item?.baseSalary || "")}${payField("Hourly Basis", "HOURLY RATE (₹)", "hourlyRate", item?.hourlyRate || "")}`;
    const employmentCards = [["Full-Time", "Fixed monthly salary, pro-rated by attendance", "briefcase"], ["Contractual", "Pay per class/lecture taken", "document"], ["Part-Time / Hybrid", "Base salary + per-class rate", "clock"], ["Hourly Basis", "Pay per working hour", "clock"]].map(([name, desc, icon]) => `<label class="staff-employment-card${employment === name ? " active" : ""}"><input type="radio" name="employmentType" value="${esc(name)}" ${employment === name ? "checked" : ""}><span>${navIcon(icon)}</span><b>${esc(name)}</b><small>${esc(desc)}</small></label>`).join("");
    return `<section class="staff-form-page"><header class="staff-page-heading"><div><div class="staff-breadcrumb">Academics / <a href="#staff" data-route="staff">Staff</a> / ${editing ? "Edit Staff" : "Add New Staff"}</div><h1>${editing ? "Edit Staff" : "Add New Staff"}</h1><p>${editing ? "Update this staff account and profile." : "Create a staff account, payroll profile, and professional details"}</p></div><a class="staff-button" href="#staff" data-staff-cancel>← Back</a></header><form class="staff-form-layout" data-admin-form="staff-record" data-edit-id="${esc(item?.id || "")}" novalidate><div class="staff-form-main"><section class="staff-section-card"><header>${navIcon("id-badge")}<h2>Account Information</h2></header><div class="staff-form-grid"><div class="staff-photo-field"><label for="staff-photo">Profile photo</label><div class="staff-photo-preview" data-staff-photo-preview>${item?.photo ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}">` : `<span>${esc(staffInitials(item?.name || "New Teacher"))}</span>`}</div><input id="staff-photo" name="photoFile" type="file" accept="image/*"><small>Image up to 2 MB.</small></div>${staffField("FULL NAME", "name", "text", item?.name || "", { required: true, placeholder: "e.g. Dr. Priya Mehta" })}${staffField("EMAIL ADDRESS", "email", "email", item?.email || "", { required: true, placeholder: "teacher@institute.com" })}<label class="staff-field"><span>PHONE <em>*</em></span><div class="staff-phone-input"><input name="countryCode" inputmode="numeric" value="${esc(item?.countryCode || "91")}" aria-label="Country code"><input name="phone" type="tel" inputmode="numeric" value="${esc(item?.phone || "")}" placeholder="10-digit mobile number" required></div><small class="staff-field-error" data-staff-error="phone"></small></label>${staffField("EMPLOYEE ID", "employeeId", "text", item?.employeeId || staffNextEmployeeId(), { required: true })}${staffSelect("STAFF TYPE", "staffType", staffTypeOf(item || {}), [["Teacher", "Teacher"], ["Admin", "Admin"], ["Accountant", "Accountant"], ["Counselor", "Counselor"], ["Receptionist", "Receptionist"], ["Librarian", "Librarian"], ["Other", "Other"]], true)}<div class="staff-field staff-field-wide"><span>BRANCHES — SELECT ALL LOCATIONS THIS STAFF WORKS AT</span>${branchesMarkup}<small class="staff-field-error" data-staff-error="branchIds"></small></div>${staffField(editing ? "NEW PASSWORD (OPTIONAL)" : "PASSWORD", "password", "password", "", { required: !editing, placeholder: "Min 8 characters" })}${staffField(editing ? "CONFIRM NEW PASSWORD" : "CONFIRM PASSWORD", "confirmPassword", "password", "", { required: !editing, placeholder: "Repeat password" })}<p class="staff-auth-note staff-field-wide">The current server authentication flow creates student/parent accounts only. Staff profiles are saved locally; passwords are not stored or sent to that endpoint.</p></div></section><section class="staff-section-card"><header>${navIcon("briefcase")}<h2>Employment Type <em>*</em></h2></header><div class="staff-employment-grid">${employmentCards}</div><div class="staff-payroll-note" data-staff-payroll-note>${esc(payrollMessage[employment] || payrollMessage["Full-Time"])}</div>${employmentFields}<div class="staff-section-divider"><h3>BANK DETAILS (FOR PAYROLL TRANSFER)</h3><div class="staff-form-grid">${staffField("ACCOUNT NUMBER", "bankAccount", "text", item?.bankAccount || "")}${staffField("BANK NAME", "bankName", "text", item?.bankName || "")}${staffField("IFSC CODE", "ifsc", "text", item?.ifsc || "", { attrs: 'maxlength="11" autocapitalize="characters"' })}${staffField("PAN NUMBER", "pan", "text", item?.pan || "", { attrs: 'maxlength="10" autocapitalize="characters"' })}</div></div></section><section class="staff-section-card"><header>${navIcon("graduation-cap")}<h2>Professional Profile</h2></header><div class="staff-form-grid">${staffField("QUALIFICATION", "qualification", "text", item?.qualification || "", { required: true })}${staffField("SPECIALIZATION", "specialization", "text", item?.specialization || "")}${staffField("EXPERIENCE (YEARS)", "experienceYears", "number", item?.experienceYears || "", { attrs: 'min="0" step="1"' })}${staffField("JOINING DATE", "joiningDate", "date", item?.joiningDate || "")}</div><div class="staff-assignment-picker"><h3>SUBJECTS TAUGHT</h3><div class="staff-form-grid">${staffSelect("Course / Class", "assignmentCourse", "", courses)}${staffSelect("Subject", "assignmentSubject", "", staffSubjects().map((subject) => [subject, subject]))}${staffSelect("Batch (All)", "assignmentBatch", "", [["", "All batches"], ...data.batches.map((entry) => [entry.id, entry.name])])}<button type="button" class="staff-button staff-add-assignment" data-staff-add-assignment>Add</button></div><div class="staff-assignment-list" data-staff-assignment-list>${assignmentRows}</div></div></section><div class="staff-form-error" data-staff-form-error role="alert"></div></div><aside class="staff-summary-card"><header>Summary</header><div class="staff-summary-person"><div class="staff-summary-avatar" data-staff-summary-avatar>${item?.photo ? `<img src="${esc(item.photo)}" alt="">` : esc(staffInitials(item?.name || "New Teacher"))}</div><div><b data-staff-summary-name>${esc(item?.name || "New Teacher")}</b><small data-staff-summary-email>${esc(item?.email || "No email entered")}</small></div></div><div class="staff-payroll-preview"><small>PAYROLL PREVIEW</small><b data-staff-summary-employment>${esc(employment)}</b><strong data-staff-summary-pay>${money(salary)}</strong><span data-staff-summary-note>${employment === "Full-Time" ? "Pro-rated by attendance" : employment === "Contractual" ? "per class" : employment === "Hourly Basis" ? "per working hour" : "Base + class rate"}</span></div><p>A login account cannot be created until the server auth flow supports staff accounts.</p><div class="staff-summary-actions"><button type="submit" class="staff-button staff-button-primary">${editing ? "✓ Save Changes" : "✓ Add New Staff"}</button><a class="staff-button" href="#staff" data-staff-cancel>Cancel</a></div></aside></form></section>`;
  }

  function leadsPage() { const rows = data.leads.map((item) => `<tr data-filter-row>${personCell(item.name, item.phone || item.email)}<td>${esc(item.course || "—")}</td><td>${esc(item.source || "Manual demo")}</td><td><span class="tag">${esc(item.status)}</span></td><td>${dateLabel(item.createdAt)}</td></tr>`); return `${pageHeading("Lead CRM", "Track local demo inquiries. No external lead source is connected.", button("＋ Add Lead", "leads/new"))}<div class="summary-row">${statCard("All inquiries", data.leads.length)}${statCard("New", data.leads.filter((item) => item.status === "New").length, "green")}${statCard("Converted", data.leads.filter((item) => item.status === "Converted").length, "orange")}</div>${table("Inquiries", ["Lead", "Interested course", "Source", "Status", "Created"], rows)}`; }
  function leadForm() { return formPage("Add Lead", "Create a local inquiry record. No message is sent.", "lead", section("Contact and inquiry", "Contact details are optional demo inputs.", field("Name", "name", "text", { required: true }) + field("Phone", "phone", "tel") + field("Email", "email", "email") + field("Interested course", "course", "select", { choices: data.courses.map((item) => [item.name, item.name]) }) + field("Source", "source", "select", { value: "Manual demo", choices: [["Manual demo", "Manual demo"], ["Website inquiry", "Website inquiry"], ["Referral", "Referral"]] }) + field("Status", "status", "select", { value: "New", choices: [["New", "New"], ["Contacted", "Contacted"], ["Converted", "Converted"], ["Closed", "Closed"]] }))); }
  function metaLeadPage() { return `${pageHeading("Meta Lead Ads Integration", "Mock setup screen. No credentials are requested and no external connection is made.")}<div class="admin-integration-grid"><article class="panel admin-integration-card"><div class="integration-icon">f</div><div><h2>Meta Lead Ads</h2><p>Connect status: <b class="status-disconnected">Not connected</b></p><p>This prototype does not connect to Meta or send lead data.</p><button class="secondary-action" data-action="meta-checklist">View setup checklist</button></div></article><article class="panel admin-integration-card"><h2>Local preview controls</h2><p>Use Lead CRM to add sample inquiries. Integration credentials, permissions and sync behavior require an approved service configuration.</p>${button("Open Lead CRM", "leads", "outline-action")}</article></div>`; }
  function nurturingPage() { return `${pageHeading("Lead Nurturing Automation", "Sequences are preview-only; no emails, SMS or WhatsApp messages are sent.", `<button class="primary-action" data-action="new-sequence">＋ Create Sequence</button>`)}<div class="summary-row">${statCard("Sequences", data.sequences.length)}${statCard("Active", data.sequences.filter((item) => item.status === "Draft").length, "green")}${statCard("Contacts", data.leads.length, "orange")}</div><section class="admin-module-grid"><article class="panel admin-feature-card"><h2>Inquiry follow-up</h2><p>Draft a local reminder sequence for new inquiries.</p><span class="tag warning">Draft only</span></article><article class="panel admin-feature-card"><h2>Course interest follow-up</h2><p>Preview a course-specific follow-up plan.</p><span class="tag">Not connected</span></article></section>${data.sequences.length ? table("Saved local sequences", ["Name", "Audience", "Status"], data.sequences.map((item) => `<tr data-filter-row><td>${esc(item.name)}</td><td>${esc(item.audience)}</td><td>${esc(item.status)}</td></tr>`)) : empty("No sequences created", "Create a local draft to explore this screen.")}`; }
  function admissionsPage() {
    const applications = admissionsAdmin.applications;
    const count = (status) => applications.filter((item) => item.status === status).length;
    const config = admissionsAdmin.publicConfig || {};
    const href = `${window.location.origin}/form.html`;
    const filters = admissionsAdmin.filters;
    const filtered = applications.filter((item) => (!filters.term || `${item.applicationNo} ${item.name} ${item.email} ${item.mobile} ${item.batchName}`.toLowerCase().includes(filters.term)) && (!filters.status || item.status === filters.status) && (!filters.batch || item.batchName === filters.batch));
    const pages = Math.max(1, Math.ceil(filtered.length / 10)); admissionsAdmin.page = Math.min(pages, Math.max(1, admissionsAdmin.page));
    const visible = filtered.slice((admissionsAdmin.page - 1) * 10, admissionsAdmin.page * 10);
      const row = (item) => `<tr data-adm-row data-search="${esc(`${item.applicationNo} ${item.name} ${item.email} ${item.mobile} ${item.batchName}`.toLowerCase())}" data-status="${esc(item.status || "Pending")}" data-batch="${esc(item.batchName || "")}"><td><span class="adm-app-number">${esc(item.applicationNo || "—")}</span></td><td><span class="adm-applicant"><i>${item.photo ? `<img src="${esc(item.photo)}" alt="">` : esc(String(item.name || "?").slice(0, 1).toUpperCase())}</i><span><b>${esc(item.name)}</b><small>${esc(item.email)}</small></span></span></td><td>${esc(item.mobile)}</td><td><span class="adm-batch">${esc(item.batchName)}</span></td><td>${item.previousYearPercent === "" || item.previousYearPercent == null ? "—" : `${esc(item.previousYearPercent)}%`}</td><td>${dateLabel(item.appliedAt?.slice(0, 10))}<small class="adm-muted">${esc(relativeAdmissionTime(item.appliedAt))}</small></td><td><span class="adm-status ${esc(String(item.status || "pending").toLowerCase().replace(/\s+/g, "-"))}">${esc(item.status || "Pending")}</span></td><td><button class="adm-eye" type="button" data-adm-view="${esc(item.id)}" aria-label="View ${esc(item.applicationNo)}">${navIcon("eye")}</button></td></tr>`;
    const body = admissionsAdmin.error ? `<tr><td colspan="8"><div class="adm-access-error"><b>Admissions could not load</b><span>${esc(admissionsAdmin.error)}</span><button type="button" data-adm-retry>Retry</button></div></td></tr>` : filtered.length ? visible.map(row).join("") : `<tr><td colspan="8"><div class="adm-empty"><b>${admissionsAdmin.loading ? "Loading applications…" : "No applications yet"}</b><span>Share the public admission link to receive applications.</span><button type="button" data-adm-copy>Copy Link</button></div></td></tr>`;
    return `<section class="adm-page">${pageHeading("Online Admissions", "Manage student applications and enrollment pipeline")}<div class="adm-public-link"><span class="adm-globe">${navIcon("broadcast")}</span><div><b>Public Admission Form</b><code data-adm-link>${esc(href)}</code></div><button type="button" data-adm-copy>${navIcon("document")} Copy Link</button><a href="${esc(href)}" target="_blank" rel="noopener">${navIcon("eye")} Preview</a><button type="button" data-adm-refresh aria-label="Refresh applications" title="Refresh applications">↻</button>${admissionsAdmin.authenticated ? `<button type="button" data-adm-toggle>${config.open ? "Admissions open · Turn off" : "Admissions closed · Turn on"}</button>` : ""}</div><div class="adm-stats"><article><strong>${applications.length}</strong><small>TOTAL</small><i>♟</i></article><article class="pending"><strong>${count("Pending")}</strong><small>PENDING</small><i>⌛</i></article><article class="review"><strong>${count("Under Review")}</strong><small>UNDER REVIEW</small><i>⌕</i></article><article class="approved"><strong>${count("Approved")}</strong><small>APPROVED</small><i>✓</i></article><article class="rejected"><strong>${count("Rejected")}</strong><small>REJECTED</small><i>×</i></article></div><div class="adm-filter"><input type="search" data-adm-search value="${esc(filters.term)}" placeholder="Search applicant name or email..." aria-label="Search applicant name or email"><select data-adm-status aria-label="Filter by status"><option value="" ${filters.status ? "" : "selected"}>All Status</option>${["Pending", "Under Review", "Approved", "Rejected"].map((status) => `<option ${filters.status === status ? "selected" : ""}>${status}</option>`).join("")}</select><select data-adm-batch aria-label="Filter by batch"><option value="" ${filters.batch ? "" : "selected"}>All Batches</option>${[...new Set(applications.map((item) => item.batchName).filter(Boolean))].map((name) => `<option ${filters.batch === name ? "selected" : ""}>${esc(name)}</option>`).join("")}</select><button class="primary-action" data-adm-filter>${navIcon("funnel")} Filter</button><button class="secondary-action" data-adm-clear>Clear</button></div><div class="adm-table"><table><thead><tr><th>APP #</th><th>APPLICANT</th><th>PHONE</th><th>FOR BATCH</th><th>PREV %</th><th>APPLIED</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>${body}</tbody></table>${!admissionsAdmin.error && filtered.length > 10 ? `<div class="adm-pagination"><span>${(admissionsAdmin.page - 1) * 10 + 1}-${Math.min(admissionsAdmin.page * 10, filtered.length)} of ${filtered.length}</span><button data-adm-page="-1" ${admissionsAdmin.page <= 1 ? "disabled" : ""}>Previous</button><button data-adm-page="1" ${admissionsAdmin.page >= pages ? "disabled" : ""}>Next</button></div>` : ""}</div></section>`;
  }
  function relativeAdmissionTime(value) { if (!value) return ""; const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000)); if (minutes < 1) return "Just now"; if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`; return `${Math.floor(hours / 24)} days ago`; }
  async function copyAdmissionLink() {
    const link = `${window.location.origin}/form.html`;
    try { await navigator.clipboard.writeText(link); } catch { const input = document.createElement("textarea"); input.value = link; input.style.position = "fixed"; input.style.opacity = "0"; document.body.append(input); input.select(); const copied = document.execCommand("copy"); input.remove(); if (!copied) return toast("Could not copy the admission link.", true); }
    toast("Link copied");
  }
  function filterAdmissionRows() {
    const active = document.activeElement, selector = active?.matches("[data-adm-search]") ? "[data-adm-search]" : active?.matches("[data-adm-status]") ? "[data-adm-status]" : active?.matches("[data-adm-batch]") ? "[data-adm-batch]" : "", position = selector === "[data-adm-search]" ? active.selectionStart : null;
    admissionsAdmin.filters = { term: (root.querySelector("[data-adm-search]")?.value || "").trim().toLowerCase(), status: root.querySelector("[data-adm-status]")?.value || "", batch: root.querySelector("[data-adm-batch]")?.value || "" }; admissionsAdmin.page = 1; shell();
    if (selector) { const next = root.querySelector(selector); next?.focus(); if (position != null) next?.setSelectionRange(position, position); }
  }
  function showAdmissionDetails(id) {
    const item = admissionsAdmin.applications.find((entry) => entry.id === id); if (!item) return toast("Application not found.", true);
    const details = [["Application number", item.applicationNo], ["Full name", item.name], ["Gender", item.gender], ["Date of birth", item.dateOfBirth], ["Mobile", item.mobile], ["Email", item.email], ["Address", item.address], ["Course / batch", item.batchName], ["Father's name", item.fatherName], ["Mother's name", item.motherName], ["Guardian phone", item.guardianPhone], ["Previous school", item.previousSchool], ["Last Year %", item.previousYearPercent === "" ? "—" : `${item.previousYearPercent}%`], ["Declaration accepted", item.declarationAcceptedAt ? new Date(item.declarationAcceptedAt).toLocaleString() : "—"], ["Applied", item.appliedAt ? new Date(item.appliedAt).toLocaleString() : "—"], ["Rejection reason", item.rejectReason || "—"]];
    const history = (item.statusHistory || []).map((entry) => `<li><b>${esc(entry.status)}</b><span>${esc(new Date(entry.at).toLocaleString())}${entry.reason ? ` · ${esc(entry.reason)}` : ""}</span></li>`).join("") || "<li>No status updates</li>";
    const actions = item.status === "Pending" ? `<button class="primary-action" data-adm-status="Under Review" data-adm-id="${esc(item.id)}">Mark Under Review</button><button class="primary-action" data-adm-status="Approved" data-adm-id="${esc(item.id)}">Approve</button><button class="secondary-action" data-adm-status="Rejected" data-adm-id="${esc(item.id)}">Reject</button>` : item.status === "Under Review" ? `<button class="primary-action" data-adm-status="Approved" data-adm-id="${esc(item.id)}">Approve</button><button class="secondary-action" data-adm-status="Rejected" data-adm-id="${esc(item.id)}">Reject</button>` : item.status === "Rejected" ? `<button class="primary-action" data-adm-status="Pending" data-adm-id="${esc(item.id)}">Re-open</button>` : `<a class="primary-action" href="#student/${esc(item.student?.id || "")}" data-route="student/${esc(item.student?.id || "")}">View student</a>`;
    showDialog(`Application ${item.applicationNo}`, `<div class="adm-detail">${item.photo ? `<img class="adm-detail-photo" src="${esc(item.photo)}" alt="Applicant photo">` : ""}<span class="adm-status ${esc(String(item.status).toLowerCase().replace(/\s+/g, "-"))}">${esc(item.status)}</span><dl>${details.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value || "—")}</dd></div>`).join("")}</dl><h3>Status history</h3><ol>${history}</ol><label class="adm-notes">Admin notes<textarea data-adm-notes>${esc(item.adminNotes || "")}</textarea></label><div class="adm-dialog-actions">${actions}<button class="secondary-action" data-adm-save-notes="${esc(item.id)}">Save notes</button></div></div>`);
    dialog?.classList.add("adm-dialog");
    dialogBody?.querySelectorAll("[data-adm-status]").forEach((button) => button.addEventListener("click", () => updateAdmissionStatus(button.dataset.admId, button.dataset.admStatus)));
    dialogBody?.querySelector("[data-adm-save-notes]")?.addEventListener("click", () => updateAdmission(id, { adminNotes: dialogBody.querySelector("[data-adm-notes]")?.value || "" }, "Admin notes saved."));
  }
  async function updateAdmissionStatus(id, status) {
    const item = admissionsAdmin.applications.find((entry) => entry.id === id); if (!item || item.status === "Approved") return;
    let rejectReason = "";
    if (status === "Rejected") { rejectReason = window.prompt("Enter a reason for rejecting this application:") || ""; if (!rejectReason.trim()) return toast("A rejection reason is required.", true); }
    if (status === "Approved" && !window.confirm("Approve this application and create its student record?")) return;
    let linkedStudent = null, createdStudent = null, rollbackToken = "";
    if (status === "Approved") {
      const existing = data.students.find((studentItem) => (item.email && String(studentItem.email || "").toLowerCase() === item.email.toLowerCase()) || (item.mobile && String(studentItem.phone || "").replace(/\D/g, "") === item.mobile));
      if (existing) {
        const link = window.confirm(`A student with this email or mobile already exists. Link application to ${existing.name}? Choose Cancel to consider creating another record.`);
        if (link) linkedStudent = existing;
        else if (!window.confirm("Create another student record anyway?")) return;
      }
      if (!linkedStudent) {
        createdStudent = { id: uid("student"), name: item.name, gender: item.gender || "", dateOfBirth: item.dateOfBirth || "", email: item.email, phone: item.mobile, address: item.address || "", photoData: item.photo || "", fatherName: item.fatherName || "", motherName: item.motherName || "", parentName: item.fatherName || item.motherName || "", guardianPhone: item.guardianPhone || "", previousSchool: item.previousSchool || "", previousYearPercent: item.previousYearPercent ?? "", courseId: batch(item.batchId)?.courseId || "", batchId: item.batchId || "", academicYearId: batch(item.batchId)?.academicYearId || data.academicYears[0]?.id || "", admissionDate: today, admissionNo: item.applicationNo, roll: `CS-${1001 + data.students.length}`, attendance: 0, status: "Active", source: "Online Admission", applicationId: item.id, photoName: "" };
        try {
          const registration = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: createdStudent.id, name: createdStudent.name, email: createdStudent.email, parentEmail: "", parentName: createdStudent.parentName }) });
          const account = await registration.json(); if (!registration.ok) throw new Error(account.error || "Student login could not be created."); rollbackToken = account.rollbackToken;
        } catch (error) { return toast(error.message, true); }
        if (!commit("Student record created from the approved admission.", (draft) => draft.students.push(createdStudent))) { if (rollbackToken) fetch("/api/auth/rollback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rollbackToken }) }).catch(() => {}); return; }
      }
    }
    const studentRecord = linkedStudent || createdStudent;
    const payload = { status, rejectReason, adminNotes: dialogBody?.querySelector("[data-adm-notes]")?.value || item.adminNotes || "", ...(studentRecord ? { student: studentRecord } : {}) };
    await updateAdmission(id, payload, status === "Approved" ? "Application approved; student record created." : `Application marked ${status}.`, async () => {
      if (createdStudent) commit("Rolled back incomplete application approval.", (draft) => { draft.students = draft.students.filter((studentItem) => studentItem.id !== createdStudent.id); });
      if (rollbackToken) await fetch("/api/auth/rollback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rollbackToken }) }).catch(() => {});
    });
  }
  async function updateAdmission(id, payload, message, rollback = null) {
    try {
      const result = await admissionApi(`/api/admissions/admin/${encodeURIComponent(id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      admissionsAdmin.applications = admissionsAdmin.applications.map((item) => item.id === id ? { ...item, ...result.application, photo: item.photo } : item); if (dialog?.open) dialog.close(); toast(message); render();
    } catch (error) { if (rollback) await rollback(); toast(error.message, true); }
  }
  async function admissionApi(path, options = {}) {
    const generic = "Cannot reach the server. Make sure the server is running (npm start) and open the admin at the same address.";
    try {
      if (!admissionAdminToken) {
        const tokenResponse = await fetch("/api/admissions/admin/token", { credentials: "same-origin" });
        if (!tokenResponse.ok || !(tokenResponse.headers.get("content-type") || "").toLowerCase().includes("application/json")) throw new Error(generic);
        const tokenResult = await tokenResponse.json(); admissionAdminToken = String(tokenResult.token || "");
        if (!admissionAdminToken) throw new Error(generic);
      }
      const headers = new Headers(options.headers || {}); headers.set("X-Admission-Admin-Token", admissionAdminToken);
      const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
      if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) throw new Error(generic);
      let result; try { result = await response.json(); } catch { throw new Error(generic); }
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "Administrator access is unavailable. Open the admin app from the running server and retry." : result.error || generic);
      return result;
    } catch (error) { if (error instanceof TypeError) throw new Error(generic); throw error; }
  }
  async function refreshAdmissionsAdmin() {
    try {
      const result = await admissionApi("/api/admissions/admin/list");
      const previous = new Set(admissionsAdmin.applications.map((item) => item.id));
      const next = Array.isArray(result.applications) ? result.applications : [];
      const received = next.some((item) => !previous.has(item.id));
      admissionsAdmin.applications = next; admissionsAdmin.error = ""; admissionsAdmin.loaded = true; admissionsAdmin.authenticated = true;
      if (received) toast("New application received.");
      if (route === "admissions") shell();
    } catch (error) { admissionsAdmin.error = error.message; admissionsAdmin.loaded = true; if (route === "admissions") shell(); }
  }
  async function loadAdmissionsAdmin() {
    if (admissionsAdmin.loading || admissionsAdmin.loaded) return;
    admissionsAdmin.loading = true;
    try {
      const yearLabel = String(data.academicYears[0]?.name || "2026-2027"), yearParts = yearLabel.match(/(\d{4})\D*(\d{2,4})/), academicYear = yearParts ? `${yearParts[1]}-${yearParts[2].length === 2 ? `${yearParts[1].slice(0, 2)}${yearParts[2]}` : yearParts[2]}` : "2026-2027";
      const [result, config] = await Promise.all([admissionApi("/api/admissions/admin/list"), admissionApi("/api/admissions/public/config")]);
      admissionsAdmin.publicConfig = config;
      admissionsAdmin.applications = Array.isArray(result.applications) ? result.applications : []; admissionsAdmin.loaded = true; admissionsAdmin.error = "";
      admissionsAdmin.authenticated = true;
      await admissionApi("/api/admissions/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ open: config.open, academicYear, batches: data.batches.map((item) => ({ id: item.id, name: item.name, course: course(item.courseId)?.name || "", active: item.status === "Active" })) }) });
      admissionsAdmin.publicConfig = config;
    } catch (error) { admissionsAdmin.error = error.message || "Cannot reach the server. Make sure the server is running (npm start) and open the admin at the same address."; admissionsAdmin.loaded = true; admissionsAdmin.authenticated = false; }
    admissionsAdmin.loading = false;
    if (route === "admissions") { shell(); }
    if (!admissionPollTimer) admissionPollTimer = window.setInterval(() => { if (route === "admissions" && document.visibilityState === "visible") refreshAdmissionsAdmin(); }, 15000);
  }
  async function toggleAdmissionState() {
    const nextOpen = admissionsAdmin.publicConfig?.open === false;
    try { await admissionApi("/api/admissions/admin/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ open: nextOpen }) }); admissionsAdmin.publicConfig = { ...admissionsAdmin.publicConfig, open: nextOpen }; toast(nextOpen ? "Admissions are open." : "Admissions are closed."); shell(); }
    catch (error) { toast(error.message, true); }
  }

  function liveClassNowState(item) {
    if (item.status === "Completed") return "completed";
    const start = new Date(`${item.date}T${item.time || "00:00"}`);
    if (Number.isNaN(start.valueOf())) return "upcoming";
    const end = new Date(start.valueOf() + Math.max(1, Number(item.duration) || 60) * 60000);
    const now = new Date();
    if (now >= end) return "completed";
    return now >= start ? "live" : "upcoming";
  }
  function liveClassStats() {
    return data.liveClasses.reduce((stats, item) => { stats[liveClassNowState(item)] += 1; return stats; }, { live: 0, upcoming: 0, completed: 0 });
  }
  function liveClassesPage() {
    const stats = liveClassStats();
    const visible = data.liveClasses.filter((item) => liveClassFilter === "all" || liveClassNowState(item) === liveClassFilter);
    const platforms = [["jitsi", "Jitsi (Free)", "Link needed"], ["zoom", "Zoom", "API required"], ["meet", "Google Meet", "Link needed"], ["teams", "Teams", "API required"], ["custom", "Custom", "Join link"]];
    const cards = visible.map((item) => {
      const state = liveClassNowState(item);
      const statusText = state === "live" ? "Live now" : state === "completed" ? "Completed" : "Upcoming";
      const meetingUrl = safeMeetingUrl(item.meetingUrl);
      const join = meetingUrl ? `<a class="primary-action" href="${esc(meetingUrl)}" target="_blank" rel="noopener noreferrer">Join class ↗</a>` : `<button class="secondary-action" type="button" data-live-action="missing-link" data-id="${esc(item.id)}">Add meeting link</button>`;
      return `<article class="live-session-card"><div class="live-session-top"><span class="live-status ${state}"><i></i>${statusText}</span><span class="tag">${esc(item.platformLabel || "Online class")}</span></div><h2>${esc(item.title)}</h2>${item.topic ? `<p class="live-topic">${esc(item.topic)}</p>` : ""}<div class="live-session-details"><span>▣ ${dateLabel(item.date)} · ${esc(item.time || "Time not set")}</span><span>◷ ${esc(item.duration || 60)} minutes${item.daily ? " · Daily" : ""}</span><span>♟ ${esc(staff(item.teacherId)?.name || "Teacher not selected")}</span><span>▱ ${esc(batch(item.batchId)?.name || "All batches")}${item.subject ? ` · ${esc(item.subject)}` : ""}</span></div>${meetingUrl ? `<p class="live-link-preview">${esc(meetingUrl)}</p>` : `<p class="live-link-missing">No meeting URL saved. This demo does not create a video room.</p>`}<div class="live-session-actions">${join}<button class="secondary-action" type="button" data-live-action="edit" data-id="${esc(item.id)}">Edit</button><button class="secondary-action" type="button" data-live-action="complete" data-id="${esc(item.id)}" ${state === "completed" ? "disabled" : ""}>Mark completed</button><button class="secondary-action" type="button" data-live-action="delete" data-id="${esc(item.id)}">Delete</button></div></article>`;
    }).join("");
    const empty = `<section class="live-empty"><span class="live-empty-icon">▣</span><h2>${liveClassFilter === "all" ? "No live classes yet" : `No ${liveClassFilter} classes`}</h2><p>Schedule a class using Jitsi, Zoom, Google Meet, Teams, or a custom meeting link.</p><button class="primary-action" type="button" data-action="schedule-live-class">＋ &nbsp; Schedule ${data.liveClasses.length ? "Class" : "First Class"}</button></section>`;
    return `${pageHeading("Live Classes", "Schedule classes using Jitsi, Zoom, Google Meet, Teams or any custom link", `<button class="primary-action" type="button" data-action="schedule-live-class">▣ &nbsp; Schedule Class</button>`)}
      <div class="live-stats"><button class="live-stat" type="button" data-live-filter="live"><span class="live-stat-icon red">◉</span><span><small>LIVE NOW</small><b>${stats.live}</b></span></button><button class="live-stat" type="button" data-live-filter="upcoming"><span class="live-stat-icon blue">▣</span><span><small>UPCOMING</small><b>${stats.upcoming}</b></span></button><button class="live-stat" type="button" data-live-filter="completed"><span class="live-stat-icon green">✓</span><span><small>COMPLETED</small><b>${stats.completed}</b></span></button></div>
      <section class="live-platform-bar"><strong>Supported Platforms</strong><div class="live-platform-list">${platforms.map(([id, label, note]) => `<button type="button" class="live-platform-chip ${id}" data-live-platform-open="${id}">${esc(label)} <small>${esc(note)}</small></button>`).join("")}</div><button type="button" class="secondary-action live-config-button" data-action="configure-live-platforms">⚙ Configure Zoom/Teams</button></section>
      <div class="live-list-toolbar"><div><strong>Scheduled Classes</strong><span>${visible.length} ${visible.length === 1 ? "class" : "classes"}</span></div><div class="live-filter-tabs" role="group" aria-label="Filter classes">${[["all", "All"], ["live", "Live now"], ["upcoming", "Upcoming"], ["completed", "Completed"]].map(([id, label]) => `<button type="button" class="${liveClassFilter === id ? "active" : ""}" data-live-filter="${id}">${label}</button>`).join("")}</div></div>
      ${visible.length ? `<div class="live-session-list">${cards}</div>` : empty}`;
  }
  function liveClassForm() { return formPage("Schedule Live Class", "This preview saves a local schedule only; it does not create a meeting room or contact a provider.", "live-class", section("Session details", "Add the class information and, if available, paste a meeting link.", field("Session title", "title", "text", { required: true }) + field("Platform", "platform", "select", { required: true, value: "jitsi", choices: [["jitsi", "Jitsi Meet"], ["zoom", "Zoom"], ["meet", "Google Meet"], ["teams", "Microsoft Teams"], ["custom", "Custom link"]] }) + field("Topic", "topic") + field("Teacher", "teacherId", "select", { required: true, choices: activeTeachers().map((item) => [item.id, item.name]) }) + field("Subject", "subject") + field("Batch", "batchId", "select", { choices: data.batches.map((item) => [item.id, item.name]) }) + field("Date", "date", "date", { required: true, value: today }) + field("Start time", "time", "time", { required: true }) + field("Duration (minutes)", "duration", "number", { required: true, min: "1", value: "60" }) + field("Meeting URL", "meetingUrl", "url", { placeholder: "Paste the URL created in your video platform" }) + field("Daily recurring class", "daily", "checkbox") + field("Notes", "notes", "textarea", { wide: true }))); }
  function showLiveClassDialog(itemId = "") {
    liveClassPlatform = "jitsi";
    const item = itemId ? data.liveClasses.find((record) => record.id === itemId) : null;
    if (item) liveClassPlatform = item.platform || "jitsi";
    const batchChoices = [["all", "All Batches"], ...data.batches.map((record) => [record.id, record.name])];
    const platforms = [["jitsi", "▣", "Jitsi Meet", "Free · meeting link can be pasted"], ["zoom", "▣", "Zoom", "Provider integration required"], ["meet", "▣", "Google Meet", "Paste a link from Google Calendar"], ["teams", "▣", "Teams", "Provider integration required"], ["custom", "↗", "Custom Link", "Any meeting URL"]];
    const content = `<div class="live-class-dialog-shell"><div class="live-platform-picker" role="group" aria-label="Video platform">${platforms.map(([id, icon, label, sub]) => `<button type="button" class="live-platform-option ${liveClassPlatform === id ? "selected" : ""}" data-live-platform="${id}" aria-pressed="${liveClassPlatform === id}"><span>${icon}</span><b>${label}</b><small>${sub}</small>${["zoom", "teams"].includes(id) ? `<em>Configure first</em>` : ""}</button>`).join("")}</div><div class="live-platform-notice" id="live-platform-notice" role="status"></div><form class="live-class-form" data-admin-form="live-class" data-edit-id="${esc(item?.id || "")}" novalidate>
      ${field("Class title", "title", "text", { required: true, value: item?.title || "", placeholder: "e.g. JEE Physics — Electrostatics Revision", wide: true })}
      <div class="live-form-grid">${field("Topic", "topic", "text", { value: item?.topic || "", placeholder: "Specific topic for today" })}${field("Teacher", "teacherId", "select", { required: true, value: item?.teacherId || "", choices: activeTeachers().map((record) => [record.id, record.name]) })}${field("Subject", "subject", "text", { value: item?.subject || "", placeholder: "Choose or enter a subject" })}${field("Batch", "batchId", "select", { value: item?.batchId || "all", choices: batchChoices })}${field("Date & Time", "scheduledAt", "datetime-local", { required: true, value: item ? `${item.date}T${item.time || "10:00"}` : `${today}T10:00` })}${field("Duration (minutes)", "duration", "number", { required: true, min: "1", step: "1", value: item?.duration || "60" })}${field("Meeting URL", "meetingUrl", "url", { value: item?.meetingUrl || "", placeholder: "Paste the meeting link from your provider", wide: true })}</div>
      <label class="live-recurring"><input type="checkbox" name="daily" ${item?.daily ? "checked" : ""}/><span><b>Make this a daily recurring class</b><small>Keep the same class details for a daily schedule preview.</small></span></label><div class="live-class-local-note">Local preview: schedules are saved in this browser. No provider account is connected and no meeting is created automatically.</div><div class="admin-form-error" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button type="submit" class="primary-action">▣ &nbsp; ${item ? "Save Changes" : "Schedule Class"}</button></div></form></div>`;
    showDialog(item ? "Edit Live Class" : "Schedule Live Class", content);
    dialogBody.classList.add("live-class-dialog");
    updateLivePlatformNotice();
  }
  function updateLivePlatformNotice() {
    if (!dialogBody) return;
    dialogBody.querySelectorAll("[data-live-platform]").forEach((button) => { const selected = button.dataset.livePlatform === liveClassPlatform; button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected)); });
    const notice = dialogBody.querySelector("#live-platform-notice");
    if (!notice) return;
    const text = { jitsi: "Jitsi Meet selected. Paste an existing room URL if you have one; this preview does not create a room.", zoom: "Zoom selected. Connect a provider integration in a future phase, or paste a meeting URL here.", meet: "Google Meet selected. Create the meeting in Google Calendar, then paste its URL here.", teams: "Teams selected. Connect a provider integration in a future phase, or paste a meeting URL here.", custom: "Custom link selected. Paste the URL students should use to join." };
    notice.textContent = text[liveClassPlatform];
    const link = dialogBody.querySelector('[name="meetingUrl"]');
    if (link) link.required = liveClassPlatform === "custom";
  }
  function showLivePlatformSetup() {
    showDialog("Configure Zoom / Teams", `<div class="live-class-local-note">Zoom and Teams need an approved provider integration before this preview can create meetings. No API keys or passwords are collected or stored here.</div><h3>What you can do now</h3><ol class="live-setup-list"><li>Create a meeting in Zoom or Microsoft Teams.</li><li>Choose that platform when scheduling a class.</li><li>Paste the meeting URL into the class form.</li><li>Use Join class to open the saved URL.</li></ol><button type="button" class="secondary-action" data-action="close-dialog">Got it</button>`);
  }
  function handleLiveClassAction(action, id) {
    const item = data.liveClasses.find((record) => record.id === id);
    if (!item) return;
    if (action === "edit" || action === "missing-link") return showLiveClassDialog(id);
    if (action === "complete") {
      commit("Class marked as completed.", (draft) => { const record = draft.liveClasses.find((entry) => entry.id === id); if (record) record.status = "Completed"; });
      return;
    }
    if (action === "delete") showDialog("Delete this class?", `<p>This removes “${esc(item.title)}” from the local Admin demo.</p><div class="dialog-actions"><button type="button" class="secondary-action" data-action="close-dialog">Cancel</button><button type="button" class="danger-action" data-confirm-live-delete="${esc(id)}">Delete class</button></div>`);
  }
  const reportCatalog = [
    { id: "student-progress", title: "Student Progress Report", description: "Student-wise exam progress table with present report & rankings", icon: "table", color: "#2862ec", tint: "#edf3ff" },
    { id: "student-details", title: "Student Details Report", description: "Detailed student profile, course, batch and enrollment info", icon: "id-card", color: "#2862ec", tint: "#edf3ff", view: true },
    { id: "student-subjects", title: "Student Assigned Subject Report", description: "Students with their assigned subjects, courses & batch details", icon: "bookmark", color: "#08a6df", tint: "#eaf8ff", view: true },
    { id: "attendance", title: "Attendance Report", description: "Track daily, batch-wise and student-wise attendance rates", icon: "clipboard-check", color: "#2862ec", tint: "#edf3ff", view: true },
    { id: "fee-collection", title: "Fee Collection", description: "Monthly collection trends, payment methods breakdown", icon: "cash", color: "#08a87c", tint: "#e9faf3", view: true },
    { id: "fee-defaulters", title: "Fee Defaulters", description: "List of students with overdue fees and amounts", icon: "alert-filled", color: "#ed424b", tint: "#fff0f0", view: true },
    { id: "student-performance", title: "Student Performance", description: "Individual student exam scores and ranking", icon: "chart", color: "#2862ec", tint: "#edf3ff" },
    { id: "batch-performance", title: "Batch Performance", description: "Compare performance across different batches", icon: "layers", color: "#ef9800", tint: "#fff7e6" },
    { id: "exam-analysis", title: "Exam Analysis", description: "Pass/fail ratio, average scores per exam", icon: "list-check", color: "#16a6dc", tint: "#eaf8ff" },
    { id: "teacher-performance", title: "Teacher Performance", description: "Class load, subject coverage, homework given", icon: "presentation", color: "#8654ed", tint: "#f3efff" },
    { id: "enrollment", title: "Enrollment Report", description: "Monthly new admissions and batch-wise strength", icon: "user-plus", color: "#e84698", tint: "#fff0f7", view: true },
    { id: "dropout", title: "Dropout Analysis", description: "Inactive/dropped students analysis", icon: "user-minus", color: "#e9434c", tint: "#fff0f0", view: true },
    { id: "revenue", title: "Revenue Report", description: "Monthly and yearly revenue trends", icon: "rupee", color: "#08a87c", tint: "#e9faf3", view: true },
    { id: "transactions", title: "Transaction Report", description: "Consolidated financial ledger for fee collection, income, expenses & payroll", icon: "file-chart", color: "#08a87c", tint: "#e9faf3" },
    { id: "homework", title: "Homework Report", description: "Assignment submission rates and grades", icon: "book", color: "#e99200", tint: "#fff7e6" },
    { id: "communication", title: "Communication Log", description: "SMS, WhatsApp, email delivery tracking", icon: "megaphone", color: "#2862ec", tint: "#edf3ff" },
    { id: "timetable", title: "Timetable Utilization", description: "Slot usage by day, teacher load & room utilisation", icon: "calendar", color: "#2862ec", tint: "#edf3ff" },
    { id: "at-risk", title: "At-Risk Students", description: "Early warning system for struggling students", icon: "heart-pulse", color: "#ed424b", tint: "#fff0f0", view: true },
    { id: "discounts", title: "Discount Analysis", description: "Discounts given, impact on revenue", icon: "tag", color: "#009bb3", tint: "#e9faff" },
    { id: "inventory", title: "Inventory Report", description: "Stock levels, distributions, low-stock alerts & overdue returns", icon: "package", color: "#079f8b", tint: "#e9faf6" },
    { id: "deleted-students", title: "Deleted Students (Trash)", description: "View soft-deleted students, restore or permanently delete", icon: "trash", color: "#ed424b", tint: "#fff0f0" },
    { id: "export-students", title: "Export: Students CSV", description: "Download full student list as CSV", icon: "download", color: "#2862ec", tint: "#f0f4ff", export: "students" },
    { id: "export-fees", title: "Export: Fees CSV", description: "Download fee collection data as CSV", icon: "download", color: "#08a87c", tint: "#e9faf3", export: "fees" },
    { id: "export-attendance", title: "Export: Attendance CSV", description: "Download attendance records as CSV", icon: "download", color: "#e99200", tint: "#fff7e6", export: "attendance" },
    { id: "app-login", title: "App Login Status", description: "View last activity and login history on mobile app", icon: "smartphone", color: "#2862ec", tint: "#edf3ff" }
  ];
  function reportIcon(name) {
    const icons = {
      table: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16m6-16v16"/>',
      "id-card": '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M5.5 16c.5-2 4.5-2 5 0m3-7h5m-5 4h5"/>',
      bookmark: '<path d="M6 4h12v17l-6-4-6 4zM9 8h6m-6 3h4"/>',
      "clipboard-check": '<rect x="5" y="5" width="14" height="17" rx="2"/><path d="M9 5V3h6v2m-7 8 2 2 4-4"/>',
      cash: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M7 9H6m12 0h-1M7 16H6m12 0h-1"/>',
      "alert-filled": '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M12 7v6m0 4h.01" stroke="#fff" stroke-width="2.4"/>',
      chart: '<path d="M4 20V10m5 10V5m5 15v-7m5 7V3M2 20h20"/>',
      layers: '<path d="m12 3 9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
      "list-check": '<path d="M9 6h12M9 12h12M9 18h12M3 6l1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/>',
      presentation: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M12 17v4m-4 0h8m-9-8 3-3 2 2 4-4"/>',
      "user-plus": '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1m4-11v6m-3-3h6"/>',
      "user-minus": '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1m3-8h5"/>',
      rupee: '<path d="M5 5h14M5 9h14M7 5c7 0 7 8 0 8h-1l9 7"/>',
      "file-chart": '<path d="M6 3h8l5 5v13H6zM14 3v5h5M9 17v-3m3 3v-6m3 6v-5"/>',
      book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22zM4 5v17m4-15h8"/>',
      megaphone: '<path d="m3 11 18-6v14L3 13zM7 14l2 6h4l-2-5m10-7 2-2m-2 11 2 2"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 4h2m3 0h2m-7 4h2"/>',
      "heart-pulse": '<path d="M20.8 8.8c0 5.2-8.8 11-8.8 11s-8.8-5.8-8.8-11A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 8.8 2.5zM4 12h4l2-3 3.5 7 2-4H20"/>',
      tag: '<path d="M20 13 13 20 3 10V4h6z"/><circle cx="7" cy="8" r="1"/>',
      package: '<path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5m-9 5v8m-4-15 9 5"/>',
      trash: '<path d="M3 6h18m-14 0 1 15h8l1-15M9 6V3h6v3m-5 4v7m4-7v7"/>',
      download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
      smartphone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 5h4m-3 14h2"/>',
      arrow: '<circle cx="12" cy="12" r="10"/><path d="M7 12h10m-4-4 4 4-4 4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.table}</svg>`;
  }
  function reportStats() {
    const month = today.slice(0, 7);
    const revenue = data.payments.filter((item) => String(item.date || "").startsWith(month)).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalFees = data.fees.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const collected = data.payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const activeStudents = data.students.filter((item) => String(item.status || "Active").toLowerCase() !== "dropped");
    const attendance = activeStudents.length ? Math.round(activeStudents.reduce((sum, item) => sum + attendanceRate(item.id), 0) / activeStudents.length) : 0;
    const atRisk = activeStudents.filter((item) => (item.risk ? String(item.risk).toLowerCase() !== "low" : attendanceRate(item.id) < 75)).length;
    const compact = revenue >= 1000 ? `₹${(revenue / 1000).toFixed(1)}K` : money(revenue);
    const feeRate = totalFees ? `${(collected / totalFees * 100).toFixed(1)}%` : "0%";
    return [["Students", String(data.students.length), "user-plus", "#2862ec", "#edf3ff"], ["Revenue", compact, "rupee", "#08a87c", "#e9faf3"], ["Exams", String(data.exams.length), "list-check", "#e99200", "#fff7e6"], ["Attendance", `${attendance}%`, "clipboard-check", "#16a6dc", "#eaf8ff"], ["Fee Collected", feeRate, "chart", "#2862ec", "#f0f4ff"], ["At Risk", String(atRisk), "alert-filled", "#ed424b", "#fff0f0"]];
  }
  function reportsPage() {
    const stats = reportStats().map(([label, value, icon, color, tint]) => `<article class="report-stat" style="--report-accent:${color};--report-tint:${tint}"><span class="report-stat-icon">${reportIcon(icon)}</span><span class="report-stat-copy"><small>${esc(label)}</small><b>${esc(value)}</b></span></article>`).join("");
    const cards = reportCatalog.map((item) => {
      const style = `--report-accent:${item.color};--report-tint:${item.tint}`;
      const content = `<span class="report-card-icon">${reportIcon(item.icon)}</span><span class="report-card-copy"><b>${esc(item.title)}</b><small>${esc(item.description)}</small></span><span class="report-card-arrow">${reportIcon("arrow")}</span>`;
      return item.export
        ? `<button type="button" class="report-card" style="${style}" data-export-report="${item.export}" aria-label="${esc(item.title)}: ${esc(item.description)}">${content}</button>`
        : `<a class="report-card" style="${style}" href="#reports/detail/${item.id}" data-route="reports/detail/${item.id}" aria-label="Open ${esc(item.title)}">${content}</a>`;
    }).join("");
    return `<section class="reports-page"><header class="reports-heading"><h1>Reports &amp; Analytics</h1><p>${reportCatalog.length} comprehensive reports for insights</p></header><section class="reports-stats" aria-label="Institute statistics">${stats}</section><section class="reports-grid" aria-label="Reports">${cards}</section><footer class="reports-footer"><span>${reportCatalog.length} reports</span><span>Figures use the records saved in this browser</span></footer></section>`;
  }
  function reportDetail(id) {
    const spec = reportCatalog.find((item) => item.id === id);
    if (!spec) return `${pageHeading("Report not found", "This report is not available.", button("← Reports", "reports", "secondary-action"))}${empty("Report not found", "Return to Reports & Analytics to choose a report.")}`;
    if (!spec.view) return `<section class="report-placeholder"><a class="secondary-action" href="#reports" data-route="reports">← All reports</a><span class="report-placeholder-icon" style="--report-accent:${spec.color};--report-tint:${spec.tint}">${reportIcon(spec.icon)}</span><h1>${esc(spec.title)}</h1><p>Coming soon</p><small>${esc(spec.description)}. This report needs data or workflows that are not currently available in this local demo.</small></section>`;
    let columns = [], rows = [];
    const row = (...values) => `<tr>${values.map((value) => `<td>${esc(value ?? "—")}</td>`).join("")}</tr>`;
    if (id === "student-details") {
      columns = ["Admission no.", "Student", "Email / phone", "Course", "Batch", "Admission date", "Status"];
      rows = data.students.map((item, index) => row(item.admissionNo || `ADM-${(item.admissionDate || today).slice(0, 4)}-${String(index + 1).padStart(4, "0")}`, item.name, item.email || item.phone, course(item.courseId)?.name, batch(item.batchId)?.name, dateLabel(item.admissionDate), item.status || "Active"));
    } else if (id === "student-subjects") {
      columns = ["Student", "Assigned subjects", "Course", "Batch"];
      rows = data.students.map((item) => row(item.name, (item.subjects || []).join(", ") || "None assigned", course(item.courseId)?.name, batch(item.batchId)?.name));
    } else if (id === "attendance") {
      columns = ["Date", "Student", "Batch", "Status"];
      rows = data.attendance.flatMap((day) => (day.records || []).map((record) => row(dateLabel(day.date), student(record.studentId)?.name, batch(day.batchId)?.name, record.status)));
    } else if (id === "fee-collection") {
      columns = ["Date", "Student", "Fee", "Method", "Amount"];
      rows = [...data.payments].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => row(dateLabel(item.date), student(item.studentId)?.name, fee(item.feeId)?.title, item.method, money(item.amount)));
    } else if (id === "fee-defaulters") {
      columns = ["Student", "Fee", "Due date", "Amount overdue"];
      rows = data.fees.filter((item) => item.dueDate < today && balance(item.id) > 0).map((item) => row(student(item.studentId)?.name, item.title, dateLabel(item.dueDate), money(balance(item.id))));
    } else if (id === "enrollment") {
      columns = ["Admission date", "Student", "Batch", "Course", "Status"];
      rows = [...data.students].sort((a, b) => String(b.admissionDate).localeCompare(String(a.admissionDate))).map((item) => row(dateLabel(item.admissionDate), item.name, batch(item.batchId)?.name, course(item.courseId)?.name, item.status || "Active"));
    } else if (id === "dropout") {
      columns = ["Student", "Batch", "Course", "Admission date", "Status"];
      rows = data.students.filter((item) => ["inactive", "dropped"].includes(String(item.status || "").toLowerCase())).map((item) => row(item.name, batch(item.batchId)?.name, course(item.courseId)?.name, dateLabel(item.admissionDate), item.status));
    } else if (id === "revenue") {
      columns = ["Month", "Transactions", "Revenue"];
      const totals = new Map();
      data.payments.forEach((item) => { const key = String(item.date || "").slice(0, 7); if (!key) return; const total = totals.get(key) || { count: 0, amount: 0 }; total.count += 1; total.amount += Number(item.amount || 0); totals.set(key, total); });
      rows = [...totals.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, total]) => row(dateLabel(`${key}-01`), total.count, money(total.amount)));
    } else if (id === "at-risk") {
      columns = ["Student", "Batch", "Attendance", "Status"];
      rows = data.students.filter((item) => String(item.status || "Active").toLowerCase() !== "dropped" && (item.risk ? String(item.risk).toLowerCase() !== "low" : attendanceRate(item.id) < 75)).map((item) => row(item.name, batch(item.batchId)?.name, `${attendanceRate(item.id)}%`, item.status || "Active"));
    }
    const reportRows = rows.length ? rows.map((item) => item) : [];
    const reportTable = `<section class="panel admin-table-panel report-data-table"><div class="admin-table-toolbar"><div><b>${esc(spec.title)}</b><small>${reportRows.length} record${reportRows.length === 1 ? "" : "s"} · Local browser data</small></div></div><div class="table-wrap"><table class="data-table"><thead><tr>${columns.map((label) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${reportRows.length ? reportRows.join("") : `<tr><td colspan="${columns.length}">${empty("No records to show", "Matching records will appear here when available.")}</td></tr>`}</tbody></table></div></section>`;
    return `<section class="report-detail"><header><a class="secondary-action" href="#reports" data-route="reports">← All reports</a><div><h1>${esc(spec.title)}</h1><p>${esc(spec.description)}</p></div></header>${reportTable}</section>`;
  }
  function ptmPage() { const rows = data.ptmSessions.map((item) => `<tr data-filter-row><td>${esc(item.title)}</td><td>${dateLabel(item.date)} · ${esc(item.time)}</td><td>${esc(item.teacherName || "Not assigned")}</td><td>${esc(item.audience || "Parents")}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`); return `${pageHeading("Parent-Teacher Meetings", "Schedule a local PTM record. No booking notification is sent.", button("＋ Schedule PTM Session", "ptm/new"))}${table("PTM sessions", ["Session", "Date & time", "Teacher", "Audience", "Status"], rows)}`; }
  function ptmForm() { return formPage("Schedule PTM Session", "Save a local meeting schedule preview.", "ptm", section("Session details", "Confirm the time and teacher with your institute before sharing.", field("Session title", "title", "text", { required: true }) + field("Date", "date", "date", { required: true }) + field("Start time", "time", "time", { required: true }) + field("Teacher", "teacherId", "select", { choices: activeTeachers().map((item) => [item.id, item.name]) }) + field("Audience", "audience", "select", { value: "Parents", choices: [["Parents", "Parents"], ["Students and parents", "Students and parents"]] }) + field("Notes", "notes", "textarea", { wide: true }))); }
  function broadcastPage() { const recent = data.communications.map((item) => `<tr data-filter-row><td>${esc(item.title)}</td><td>${esc(item.audience)}</td><td>${esc(item.channel)}</td><td>${dateLabel(item.date)}</td><td><span class="tag warning">Saved preview</span></td></tr>`); return `${pageHeading("Bulk Communication", "Compose and save a local message preview. Nothing is sent.")}<div class="admin-communication-grid"><form class="admin-form-card" data-admin-form="communication" novalidate>${section("Compose message", "Delivery is not connected. Save creates a local preview record only.", field("Audience", "audience", "select", { required: true, choices: [["All students", "All students"], ["Parents", "Parents"], ...data.batches.map((item) => [item.id, `Batch · ${item.name}`])] }) + field("Channel", "channel", "select", { required: true, choices: [["In-app preview", "In-app preview"], ["Email preview", "Email preview"], ["SMS preview", "SMS preview"], ["WhatsApp preview", "WhatsApp preview"]] }) + field("Title", "title", "text", { required: true }) + field("Message", "message", "textarea", { required: true, wide: true }))}<div class="admin-form-error" aria-live="polite"></div><div class="admin-form-actions"><button type="submit" class="primary-action">Save message preview</button></div></form><aside class="panel admin-deferred-card"><h2>Delivery state</h2><span class="tag warning">Not connected</span><p>Email, SMS, WhatsApp and in-app messages are not delivered by this prototype.</p></aside></div>${table("Saved message previews", ["Title", "Audience", "Channel", "Saved", "Status"], recent)}`; }
  function messagesPage() { const threads = data.messages; const active = threads.find((item) => item.id === selectedThread) || threads[0]; return `${pageHeading("Messages Inbox", "Local conversation preview. Replies are not delivered to users.")}<div class="admin-inbox"><aside><h2>Conversations</h2>${threads.length ? threads.map((item) => `<button class="admin-thread ${active?.id === item.id ? "active" : ""}" data-thread="${item.id}">${personCell(item.name, item.subject || "Local preview")}</button>`).join("") : empty("No conversations", "Inbox messages are not connected.")}</aside><section><header>${active ? `<b>${esc(active.name)}</b><small>${esc(active.subject || "Local demo thread")}</small>` : "Select a conversation"}</header><div class="admin-thread-messages">${active ? (active.replies || []).map((reply) => `<p class="${reply.from === "Admin" ? "sent" : "received"}">${esc(reply.text)}<small>${reply.from === "Admin" ? "Admin · local" : "Contact · sample"}</small></p>`).join("") : empty("No message selected", "Create a conversation only when a local demo record exists.")}</div>${active ? `<form data-admin-form="reply" data-thread-id="${active.id}" class="admin-reply"><input name="message" required placeholder="Write a local reply preview…" aria-label="Reply message"/><button type="submit" class="primary-action">Save reply</button></form>` : ""}</section></div>`; }
  function testSeriesPage() { return `${pageHeading("Test Series", "Organize local exam records into a named series.", button("＋ Create Test Series", "test-series/new"))}<div class="admin-card-grid">${data.testSeries.length ? data.testSeries.map((item) => `<article class="panel admin-feature-card"><span class="tag">${esc(item.status)}</span><h2>${esc(item.name)}</h2><p>${esc(item.description || "Local test series")}</p><small>${item.examIds.length} exams linked</small></article>`).join("") : empty("No test series created", "Create a series to organize exams in this local demo.")}</div>`; }
  function testSeriesForm() { return formPage("Create Test Series", "Create an organizer record; exam attempts and rankings are deferred.", "test-series", section("Series details", "Exams can be linked after creation.", field("Series name", "name", "text", { required: true }) + field("Description", "description", "textarea", { wide: true }) + field("Status", "status", "select", { value: "Draft", choices: [["Draft", "Draft"], ["Active", "Active"]] }))); }
  function examsPage(mode = "Online") { const records = data.exams.filter((item) => mode === "Offline" ? item.mode.startsWith("Offline") : !item.mode.startsWith("Offline")); const rows = records.map((item) => `<tr data-filter-row><td><b>${esc(item.title)}</b></td><td>${esc(batch(item.batchId)?.name || "—")}</td><td>${esc(item.subject || "—")}</td><td>${dateLabel(item.date)}</td><td>${esc(item.maxMarks)}</td><td><span class="tag">${esc(item.mode)}</span></td></tr>`); const title = mode === "Offline" ? "Offline Exams" : "Online Exams"; return `${pageHeading(title, "Exam setup is local-only; attempts, grading and result publishing are not connected.", button("＋ Create Exam", "exams/new"))}${table(title, ["Exam", "Batch", "Subject", "Scheduled", "Marks", "Mode"], rows)}`; }
  function examForm() { return formPage("Create New Exam", "Save an exam setup record. Student attempts and marks are not processed.", "exam", section("Exam mode", "Choose an online or paper exam setup.", field("Mode", "mode", "select", { required: true, choices: [["Online", "Online Exam"], ["Offline / Paper", "Offline / Paper Exam"]] })) + section("Exam details", "Course and batch options come from local Admin records.", field("Exam title", "title", "text", { required: true }) + field("Course", "courseId", "select", { required: true, choices: data.courses.map((item) => [item.id, item.name]) }) + field("Batch", "batchId", "select", { required: true, choices: data.batches.map((item) => [item.id, item.name]) }) + field("Subject", "subject", "text", { required: true }) + field("Exam date", "date", "date", { required: true }) + field("Start time", "time", "time", { required: true }) + field("Duration (minutes)", "duration", "number", { required: true, min: "1", step: "1" }) + field("Maximum marks", "maxMarks", "number", { required: true, min: "1", step: "1" }) + field("Instructions", "instructions", "textarea", { wide: true })) + section("Settings", "This prototype does not provide proctoring or automated grading.", `<label class="field-label span-two admin-check"><input type="checkbox" name="publish" />Mark as published in this local demo</label>`)); }
  function questionBankPage() { const rows = data.questions.map((item) => `<tr data-filter-row><td>${esc(item.subject)}</td><td>${esc(item.type)}</td><td>${esc(item.prompt)}</td><td>${esc(item.difficulty)}</td><td>${dateLabel(item.createdAt)}</td></tr>`); return `${pageHeading("Question Bank", "Store local sample questions by subject and type.", button("＋ Add Question", "question-bank/new"))}${table("Question bank", ["Subject", "Type", "Question", "Difficulty", "Added"], rows)}`; }
  function questionForm() { return formPage("Add Question", "Question stays in local browser storage and is not linked to an exam automatically.", "question", section("Question details", "Do not add copyrighted exam material unless you have permission.", field("Subject", "subject", "text", { required: true }) + field("Question type", "type", "select", { required: true, choices: [["Multiple choice", "Multiple choice"], ["Short answer", "Short answer"], ["Numerical", "Numerical"], ["True / False", "True / False"]] }) + field("Difficulty", "difficulty", "select", { choices: [["Easy", "Easy"], ["Medium", "Medium"], ["Hard", "Hard"]] }) + field("Question", "prompt", "textarea", { required: true, wide: true }) + field("Option A", "optionA") + field("Option B", "optionB") + field("Option C", "optionC") + field("Option D", "optionD") + field("Answer / key", "answer", "text", { help: "No automatic grading is performed." }))); }
  function homeworkPage() { const rows = data.homework.map((item) => `<tr data-filter-row><td>${esc(item.title)}</td><td>${esc(batch(item.batchId)?.name || "—")}</td><td>${esc(item.subject)}</td><td>${dateLabel(item.dueDate)}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`); return `${pageHeading("Homework & Assignments", "Assignments are local records; student submissions and notifications are not connected.", button("＋ Assign Homework", "homework/new"))}<div class="summary-row">${statCard("Assignments", data.homework.length)}${statCard("Pending review", data.homework.filter((item) => item.status === "Review").length, "orange")}${statCard("Delivery", "Not connected", "green")}</div>${table("Assignments", ["Title", "Batch", "Subject", "Due date", "Status"], rows)}`; }
  function homeworkForm() { return formPage("Assign Homework", "Save an assignment preview. No students are notified.", "homework", section("Assignment details", "Submissions and grading are outside this prototype.", field("Title", "title", "text", { required: true }) + field("Batch", "batchId", "select", { required: true, choices: data.batches.map((item) => [item.id, item.name]) }) + field("Subject", "subject", "text", { required: true }) + field("Due date", "dueDate", "date", { required: true }) + field("Instructions", "description", "textarea", { wide: true }))); }
  function attendancePage() { const batchId = root.querySelector("#attendance-batch")?.value || data.batches[0]?.id || ""; const day = root.querySelector("#attendance-date")?.value || today; const roster = data.students.filter((item) => !batchId || item.batchId === batchId); const saved = data.attendance.find((item) => item.batchId === batchId && item.date === day); const records = roster.map((item) => { const status = saved?.records.find((record) => record.studentId === item.id)?.status || ""; return `<tr data-attendance-row data-filter-row data-student-id="${item.id}" data-status="${status}"><td>${personCell(item.name, item.roll)}</td><td>${esc(batch(item.batchId)?.name || "—")}</td><td><div class="attendance-controls">${[["P", "Present"], ["A", "Absent"], ["L", "Late"], ["E", "Excused"]].map(([code, name]) => `<button type="button" class="att-btn ${status === code ? "selected" : ""}" data-mark="${code}" aria-label="${name} for ${esc(item.name)}">${code}</button>`).join("")}</div></td></tr>`; }); const marked = saved?.records.length || 0; return `${pageHeading("Attendance", "Mark daily student attendance in this local demo.")}<div class="filters-row"><label>Batch<select id="attendance-batch" class="form-control">${data.batches.map((item) => `<option value="${item.id}" ${item.id === batchId ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label>Date<input id="attendance-date" class="form-control" type="date" value="${esc(day)}" /></label><span class="inline-note">Same-day correction in this prototype overwrites the batch/date entry.</span><button class="primary-action" data-save-attendance>Save Attendance</button></div><div class="summary-row">${statCard("Roster", roster.length)}${statCard("Marked", marked, "green")}${statCard("Unmarked", Math.max(0, roster.length - marked), "orange")}</div>${table("Student roster", ["Student", "Batch", "Status · P / A / L / E"], records)}`; }
  function timetablePage() { const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]; const rows = days.map((day) => { const sessions = data.liveClasses.filter((item) => new Date(`${item.date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" }) === day); return `<tr><td>${day}${day === "Monday" ? `<br/><span class="today-chip">Today</span>` : ""}</td><td>${sessions.length ? sessions.map((item) => `<span class="schedule-item">${esc(item.time)} · ${esc(item.title)}<small>${esc(batch(item.batchId)?.name || "")}</small></span>`).join("") : "No classes"}</td></tr>`; }); return `${pageHeading("Timetable", "Weekly view of locally scheduled live-class records.", `<button type="button" class="primary-action" data-action="schedule-live-class">＋ Schedule Class</button>`)}${table("Weekly schedule", ["Day", "Classes"], rows)}`; }

  function settingsPage() { return `${pageHeading("Settings", "Local preview preferences. Account, payment and external service settings are not connected.")}<div class="admin-card-grid"><article class="panel admin-feature-card"><h2>Institute profile</h2><p>JEE Mentor · Local demo workspace</p><span class="tag warning">Preview only</span></article><article class="panel admin-feature-card"><h2>Data storage</h2><p>Admin demo records use this browser's local storage under <code>cs-admin-demo-v1</code>.</p><span class="tag">No cloud sync</span></article><article class="panel admin-feature-card"><h2>Integrations</h2><p>Payment, messaging, video and AI providers are not connected.</p><span class="tag warning">Not connected</span></article></div>`; }
  function profilePage() { return `${pageHeading("Administrator Profile", "Demo account details; no authentication settings are changed.")}<section class="panel admin-profile-card"><div class="panel-body">${personCell("Ananya Sharma", "Institute Administrator · Local demo")}<p>Workspace: JEE Mentor</p><p>Role: Administrator</p><span class="tag warning">Local prototype</span></div></section>`; }
  function roadmapPage(item) { return `<div class="page-title-row"><div><div class="breadcrumb">Administrator / ${esc(item.group)} / ${esc(item.label)}</div><h1>${esc(item.label)}</h1></div></div><section class="panel admin-deferred-card"><p>This module is part of the local demo roadmap. No data yet.</p>${button("Back to dashboard", "dashboard", "secondary-action")}</section>`; }
  function deferredPage(id) { const labels = { results: "Results & Report Cards", marks: "Marks", expenses: "Expenses & Income", payroll: "Payroll & Payslips", salary: "Staff Salary", library: "Library Management", certificates: "Certificates", "id-cards": "ID Cards", materials: "Learning Materials", subjects: "Subject Management", topics: "Topic Management", "fee-structures": "Fee Structures", discounts: "Discounts & Coupons", "payment-reminders": "Payment Reminders", "staff-attendance": "Staff Attendance", payslips: "Staff Payslips", "video-lectures": "Video Lectures" }; const label = labels[id] || (pageTitles[id] || id.replace(/-/g, " ")); return `${pageHeading(label, "This module was identified in the reference scope. Its detailed workflow is not implemented in this UI-only phase.")}<section class="panel admin-deferred-card"><span class="tag warning">Deferred module</span><h2>${esc(label)} is not connected</h2><p>Records, calculation rules and actions for this module require a separate implementation phase. No placeholder actions will change data.</p>${button("Back to dashboard", "dashboard", "secondary-action")}</section>`; }

  function readForm(form) { return Object.fromEntries(new FormData(form).entries()); }
  function formError(form, message) { const slot = form.querySelector(".admin-form-error"); if (slot) slot.textContent = message; const submit = form.querySelector("[type=submit]"); if (submit) submit.disabled = false; if (!slot) toast(message, true); }
  function validForm(form) { if (!form.reportValidity()) return false; const slot = form.querySelector(".admin-form-error"); if (slot) slot.textContent = ""; return true; }
  async function submitForm(event) {
    const form = event.target.closest("form[data-admin-form]"); if (!form) return;
    event.preventDefault(); const type = form.dataset.adminForm; if (!["student", "staff-record", "staff-import"].includes(type) && !validForm(form)) return;
    const values = readForm(form), submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    const finish = (ok, message, destination = "") => { if (!ok) { if (submit) submit.disabled = false; return; } if (dialog?.open) dialog.close(); if (destination) { location.hash = destination; } };
    const add = (collection, record, label, destination) => finish(commit(label, (draft) => draft[collection].push(record)), label, destination);
    if (type === "staff-import") {
      const file = form.querySelector('[name="csvFile"]')?.files?.[0];
      if (!file) return formError(form, "Choose a CSV file to import.");
      let incoming; try { incoming = filterStaffCsv(await file.text()); } catch { return formError(form, "The CSV file could not be read."); }
      if (!incoming.length) return formError(form, "No rows with a name and valid email were found.");
      const seen = new Set(data.staff.map((item) => String(item.email || "").toLowerCase()));
      const records = incoming.filter((item) => { const email = String(item.email || "").trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || seen.has(email)) return false; seen.add(email); return true; }).map((item) => {
        const employmentType = ["Full-Time", "Contractual", "Part-Time / Hybrid", "Hourly Basis"].includes(item.employmenttype) ? item.employmenttype : "Full-Time", amount = Number(item.salary) || 0;
        return { id: uid("staff"), name: item.name.trim(), email: item.email.trim().toLowerCase(), phone: String(item.phone || "").replace(/\D/g, ""), countryCode: "91", photo: "", employeeId: "", staffType: item.stafftype || "Teacher", role: item.stafftype || "Teacher", status: "Active", employmentType, monthlySalary: employmentType === "Full-Time" || employmentType === "Part-Time / Hybrid" ? amount : 0, salary: employmentType === "Full-Time" || employmentType === "Part-Time / Hybrid" ? amount : 0, perClassRate: employmentType === "Contractual" ? amount : 0, baseSalary: employmentType === "Part-Time / Hybrid" ? amount : 0, hourlyRate: employmentType === "Hourly Basis" ? amount : 0, pfPercent: 12, tdsPercent: 0, branchIds: [], subjectAssignments: [], createdAt: today };
      });
      if (!records.length) return formError(form, "No new valid staff rows were found; duplicate or invalid emails were skipped.");
      if (commit(`${records.length} staff record${records.length === 1 ? "" : "s"} imported.`, (draft) => records.forEach((record) => { record.employeeId = staffNextEmployeeId(); draft.staff.push(record); }))) dialog?.close(); else if (submit) submit.disabled = false;
      return;
    }
    if (type === "staff-record") {
      const editId = form.dataset.editId, existing = editId ? staff(decodeURIComponent(editId)) : null;
      const value = (name) => { const fields = [...form.querySelectorAll(`[name="${name}"]`)]; const field = fields.find((entry) => !entry.closest("[hidden]")) || fields[0]; return String(field?.value || "").trim(); };
      const email = value("email").toLowerCase(), employeeId = value("employeeId").toUpperCase(), phone = value("phone").replace(/\D/g, ""), typeName = value("staffType"), employmentType = form.querySelector('input[name="employmentType"]:checked')?.value || "Full-Time";
      const invalid = (name, message) => { if (submit) submit.disabled = false; form.querySelectorAll(".staff-field-error").forEach((slot) => { slot.textContent = ""; }); const summary = form.querySelector("[data-staff-form-error]"); if (summary) summary.textContent = ""; staffFormError(form, name, message); return false; };
      if (!value("name")) return invalid("name", "Enter the staff member's full name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("email", "Enter a valid email address.");
      if (data.staff.some((entry) => entry.id !== editId && String(entry.email || "").toLowerCase() === email)) return invalid("email", "Another staff member already uses this email address.");
      if (phone.length !== 10) return invalid("phone", "Enter a 10-digit mobile number.");
      if (!employeeId) return invalid("employeeId", "Enter an employee ID.");
      if (data.staff.some((entry) => entry.id !== editId && String(entry.employeeId || "").toLowerCase() === employeeId.toLowerCase())) return invalid("employeeId", "This employee ID is already in use.");
      if (!typeName) return invalid("staffType", "Choose a staff type.");
      if (!value("qualification")) return invalid("qualification", "Enter the staff member's qualification.");
      const password = value("password"), confirmPassword = value("confirmPassword");
      if (!existing && password.length < 8) return invalid("password", "Password must be at least 8 characters.");
      if ((password || confirmPassword) && password.length < 8) return invalid("password", "Password must be at least 8 characters.");
      if (password !== confirmPassword) return invalid("confirmPassword", "Passwords do not match.");
      const salaryName = employmentType === "Full-Time" ? "monthlySalary" : employmentType === "Contractual" ? "perClassRate" : employmentType === "Part-Time / Hybrid" ? "baseSalary" : "hourlyRate";
      if (!value(salaryName) || Number(value(salaryName)) < 0) return invalid(salaryName, "Enter a valid non-negative pay amount.");
      if (employmentType === "Part-Time / Hybrid" && !value("perClassRate")) return invalid("perClassRate", "Enter the per-class rate.");
      const ifsc = value("ifsc").toUpperCase(), pan = value("pan").toUpperCase();
      if (ifsc && !/^[A-Z0-9]{11}$/.test(ifsc)) return invalid("ifsc", "IFSC code must contain 11 letters or digits.");
      if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return invalid("pan", "Enter a PAN in the format ABCDE1234F.");
      const record = { ...(existing || {}), id: existing?.id || uid("staff"), name: value("name"), email, phone, countryCode: value("countryCode") || "91", photo: staffPhotoData, employeeId, staffType: typeName, role: typeName, branchIds: [...form.querySelectorAll('input[name="branchIds"]:checked')].map((input) => input.value), status: existing?.status || "Active", employmentType, monthlySalary: employmentType === "Full-Time" ? Number(value("monthlySalary")) : employmentType === "Part-Time / Hybrid" ? Number(value("baseSalary")) : 0, salary: employmentType === "Full-Time" ? Number(value("monthlySalary")) : employmentType === "Part-Time / Hybrid" ? Number(value("baseSalary")) : 0, perClassRate: Number(value("perClassRate")) || 0, baseSalary: Number(value("baseSalary")) || 0, hourlyRate: Number(value("hourlyRate")) || 0, pfPercent: Number(value("pfPercent")) || 0, tdsPercent: Number(value("tdsPercent")) || 0, bankAccount: value("bankAccount"), bankName: value("bankName"), ifsc, pan, qualification: value("qualification"), specialization: value("specialization"), experienceYears: value("experienceYears"), joiningDate: value("joiningDate"), subjectAssignments: staffPendingAssignments.map((entry) => ({ ...entry })), createdAt: existing?.createdAt || today };
      const saved = commit(existing ? "Staff changes saved." : "Staff profile saved locally.", (draft) => { if (existing) { const index = draft.staff.findIndex((entry) => entry.id === existing.id); if (index >= 0) draft.staff[index] = record; } else draft.staff.push(record); });
      if (saved) { if (!existing) toast("Staff profile saved. Login account creation is unavailable in the current server auth flow.", true); location.hash = "staff"; } else if (submit) submit.disabled = false;
      return;
    }
    if (type === "course") return add("courses", { id: uid("course"), ...values }, "Course saved.", "courses");
    if (type === "batch") { if (!course(values.courseId) || !data.academicYears.some((x) => x.id === values.academicYearId)) return formError(form, "Choose a valid course and academic year."); return add("batches", { id: uid("batch"), ...values }, "Batch saved.", "batches"); }
    if (type === "student") {
      const admissionNo = String(values.admissionNo || "").trim();
      const selectedBatch = batch(values.batchId);
      const email = String(values.email || "").trim().toLowerCase();
      const parentEmail = String(values.parentEmail || "").trim().toLowerCase();
      const phoneNumber = String(values.phone || "").replace(/\D/g, "");
      const duplicateAdmission = data.students.some((item) => String(item.admissionNo || "").toLowerCase() === admissionNo.toLowerCase());
      const duplicateEmail = data.students.some((item) => String(item.email || "").trim().toLowerCase() === email);
      const invalid = (name, message) => { const input = form.elements.namedItem(name); input?.closest(".admit-field")?.classList.add("invalid"); const error = input?.closest(".admit-field")?.querySelector(".admit-error-text"); if (error) error.textContent = message; input?.focus(); formError(form, message); };
      if (!admissionNo) return invalid("admissionNo", "Admission number is required.");
      if (duplicateAdmission) return invalid("admissionNo", "This admission number is already in use.");
      if (!String(values.name || "").trim()) return invalid("name", "Enter the student's full name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("email", "Enter a valid student email address.");
      if (duplicateEmail) return invalid("email", "A student already uses this email address.");
      if (phoneNumber.length !== 10) return invalid("phone", "Enter a 10-digit phone number.");
      if (!String(values.fatherName || "").trim()) return invalid("fatherName", "Enter the father's name.");
      if (!selectedBatch) return invalid("batchId", "Choose a batch.");
      if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) return invalid("parentEmail", "Enter a valid parent email address.");
      if (parentEmail && parentEmail === email) return invalid("parentEmail", "Student and parent accounts need different email addresses.");
      const record = { id: uid("student"), ...values, admissionNo, email, phone: phoneNumber, parentEmail, courseId: selectedBatch.courseId, academicYearId: selectedBatch.academicYearId, subjects: [...form.querySelectorAll('input[name="subjects"]:checked')].map((input) => input.value), admissionDate: today, roll: `CS-${1001 + data.students.length}`, attendance: 0, status: "Active", photoName: form.querySelector("#student-photo")?.files?.[0]?.name || "", photoData };
      let rollbackToken = "";
      try {
        const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentId: record.id, name: record.name, email: record.email, parentEmail: record.parentEmail, parentName: record.parentName || record.fatherName }) });
        const result = await response.json();
        if (!response.ok) return formError(form, result.error || "Login accounts could not be created.");
        rollbackToken = result.rollbackToken || "";
      } catch { return formError(form, "Authentication service is unavailable. Start the local server before admitting a student."); }
      const ok = commit("Student admitted successfully.", (draft) => draft.students.push(record));
      if (!ok && rollbackToken) fetch("/api/auth/rollback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rollbackToken }) }).catch(() => {});
      if (photoPreview) URL.revokeObjectURL(photoPreview); photoPreview = ""; photoData = "";
      cameraStream?.getTracks().forEach((track) => track.stop()); cameraStream = null;
      return finish(ok, "", ok ? "students" : "");
    }
    if (type === "student-edit" || type === "student-action") {
      const target = student(form.dataset.studentId);
      if (!target) return formError(form, "Student record was not found.");
      if (values.batchId && !batch(values.batchId)) return formError(form, "Choose a valid batch.");
      const label = type === "student-edit" ? "Student details updated." : "Student batch and status updated.";
      const ok = commit(label, (draft) => {
        const record = draft.students.find((entry) => entry.id === target.id);
        if (type === "student-edit") { record.name = values.name.trim(); record.email = values.email.trim(); record.phone = values.phone.trim(); }
        record.status = values.status;
        if (type === "student-action") { record.batchId = values.batchId; if (values.batchId) record.courseId = batch(values.batchId)?.courseId || record.courseId; }
      });
      if (ok) dialog?.close();
      return;
    }
    if (type === "student-bulk") {
      if (!values.status) return formError(form, "Choose a status to apply.");
      const targets = data.students.filter((entry) => !values.batchId || entry.batchId === values.batchId);
      if (!targets.length) return formError(form, "There are no students in the selected batch.");
      const ids = new Set(targets.map((entry) => entry.id));
      const ok = commit(`Updated ${targets.length} student record(s).`, (draft) => draft.students.forEach((entry) => { if (ids.has(entry.id)) entry.status = values.status; }));
      if (ok) dialog?.close();
      return;
    }
    if (type === "student-import") {
      if (!pendingStudentImport.length) return formError(form, "Choose a CSV containing at least one valid row.");
      const mapped = pendingStudentImport.map((row) => {
        const courseRecord = data.courses.find((entry) => entry.name.toLowerCase() === row.course.toLowerCase());
        const batchRecord = data.batches.find((entry) => entry.name.toLowerCase() === row.batch.toLowerCase() && (!courseRecord || entry.courseId === courseRecord.id));
        if (!courseRecord || !batchRecord) return null;
        return { id: uid("student"), name: row.name, email: row.email || "", phone: row.phone || "", dateOfBirth: "", gender: "", address: "", parentName: "", parentPhone: "", parentEmail: "", relation: "Parent", courseId: courseRecord.id, batchId: batchRecord.id, academicYearId: batchRecord.academicYearId, admissionDate: today, roll: `CS-${1001 + data.students.length + pendingStudentImport.indexOf(row)}`, attendance: 0, status: "Active", photoName: "" };
      }).filter(Boolean);
      if (!mapped.length) return formError(form, "No rows matched existing course and batch names. Nothing was imported.");
      const ok = commit(`Imported ${mapped.length} student record(s).`, (draft) => draft.students.push(...mapped));
      if (ok) { pendingStudentImport = []; dialog?.close(); }
      return;
    }
    if (type === "fee") { const total = Number(values.total), studentRecord = student(values.studentId); if (!studentRecord || !Number.isFinite(total) || total <= 0 || Number(values.installments) < 1) return formError(form, "Choose a student and enter a valid fee amount and installment count."); const record = { id: uid("fee"), studentId: values.studentId, title: values.title.trim(), total, installments: Number(values.installments), dueDate: values.dueDate, note: values.note || "", createdAt: today }; return add("fees", record, "Fee assigned.", `student/${studentRecord.id}`); }
    if (type === "payment") { const feeRecord = fee(form.dataset.feeId), amount = Number(values.amount); if (!feeRecord || !Number.isFinite(amount) || amount <= 0 || amount > balance(feeRecord.id)) return formError(form, "Enter an amount greater than zero and no more than the outstanding balance."); const next = `CS-R-${String(data.payments.length + 1).padStart(4, "0")}`; const record = { id: uid("payment"), feeId: feeRecord.id, studentId: feeRecord.studentId, amount, method: values.method, date: values.date, note: values.note || "", receiptNo: next }; const ok = commit("Demo payment recorded.", (draft) => draft.payments.push(record)); if (ok) { dialog?.close(); showReceipt(record.id); } return; }
    if (type === "live-class") {
      const platformLabels = { jitsi: "Jitsi Meet", zoom: "Zoom", meet: "Google Meet", teams: "Microsoft Teams", custom: "Custom Link" };
      let classDate = values.date || "", classTime = values.time || "";
      if (values.scheduledAt) {
        const scheduledAt = new Date(values.scheduledAt);
        if (Number.isNaN(scheduledAt.valueOf())) return formError(form, "Choose a valid class date and time.");
        [classDate, classTime] = values.scheduledAt.split("T");
      }
      if (!classDate || !classTime) return formError(form, "Choose a class date and time.");
      const teacher = staff(values.teacherId), batchId = values.batchId === "all" ? "" : values.batchId, selectedBatch = batchId ? batch(batchId) : null;
      if (!values.title.trim() || !teacher || (batchId && !selectedBatch)) return formError(form, "Enter a class title and select a valid teacher and batch.");
      if (!Number.isFinite(Number(values.duration)) || Number(values.duration) < 1) return formError(form, "Enter a duration of at least one minute.");
      if (values.platform === "custom" && !values.meetingUrl) return formError(form, "Add the custom meeting URL before scheduling.");
      if (values.meetingUrl) { try { const parsed = new URL(values.meetingUrl); if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("invalid protocol"); } catch { return formError(form, "Enter a valid http or https meeting URL."); } }
      const id = form.dataset.editId || uid("live-class"), platform = values.platform || liveClassPlatform;
      if (platform === "custom" && !values.meetingUrl) return formError(form, "Add the custom meeting URL before scheduling.");
      const record = { id, title: values.title.trim(), topic: values.topic.trim(), teacherId: values.teacherId, subject: values.subject.trim(), batchId, date: classDate, time: classTime, duration: Number(values.duration), daily: values.daily === "on", platform, platformLabel: platformLabels[platform] || "Online class", meetingUrl: values.meetingUrl.trim(), notes: values.notes?.trim() || "", status: "Scheduled", createdAt: today };
      if (form.dataset.editId) {
        const old = data.liveClasses.find((entry) => entry.id === id);
        if (old?.status === "Completed") record.status = "Completed";
        const ok = commit("Live class updated in this browser.", (draft) => { const index = draft.liveClasses.findIndex((entry) => entry.id === id); if (index >= 0) draft.liveClasses[index] = record; });
        if (ok) dialog?.close();
      } else {
        const ok = commit("Live class scheduled in this browser.", (draft) => draft.liveClasses.push(record));
        if (ok) dialog?.close();
      }
      return;
    }
    const common = { id: uid(type), ...values };
    const mappings = { staff: ["staff", "Staff record saved.", "staff"], lead: ["leads", "Lead saved.", "leads"], "academic-year": ["academicYears", "Academic year saved.", "academic-years"], "live-class": ["liveClasses", "Live class schedule saved.", "live-classes"], ptm: ["ptmSessions", "PTM session saved.", "ptm"], communication: ["communications", "Message preview saved; nothing was delivered.", "broadcast"], "test-series": ["testSeries", "Test series saved.", "test-series"], exam: ["exams", "Exam setup saved.", values.mode === "Offline" ? "offline-exams" : "exams"], question: ["questions", "Question saved.", "question-bank"], homework: ["homework", "Homework assignment saved.", "homework"] };
    if (type === "reply") { const thread = data.messages.find((item) => item.id === form.dataset.threadId); if (!thread) return formError(form, "Conversation not found."); const ok = commit("Reply preview saved locally.", (draft) => { const target = draft.messages.find((item) => item.id === thread.id); target.replies ||= []; target.replies.push({ from: "Admin", text: values.message, date: today }); }); return finish(ok, ""); }
    if (type === "sequence") return add("sequences", { ...common, status: "Draft" }, "Sequence draft saved.", "lead-nurturing");
    if (mappings[type]) { const [collection, label, destination] = mappings[type]; if (type === "academic-year" && values.endDate <= values.startDate) return formError(form, "The end date must be after the start date."); if (type === "exam" && batch(values.batchId)?.courseId !== values.courseId) return formError(form, "Choose a batch belonging to the selected course."); return add(collection, common, label, destination); }
    formError(form, "No local save action is configured for this form.");
  }
  function saveAttendance() {
    const batchId = root.querySelector("#attendance-batch")?.value, date = root.querySelector("#attendance-date")?.value; if (!batchId || !date) return toast("Choose a batch and date first.", true);
    const records = [...root.querySelectorAll("[data-attendance-row]")].filter((row) => row.dataset.status).map((row) => ({ studentId: row.dataset.studentId, status: row.dataset.status }));
    const ok = commit("Attendance saved.", (draft) => { const old = draft.attendance.find((item) => item.batchId === batchId && item.date === date); if (old) old.records = records; else draft.attendance.push({ id: uid("attendance"), batchId, date, records }); }); if (ok) render();
  }
  function exportVisible() {
    const tableEl = root.querySelector(".data-table, .students-table"); if (!tableEl) return toast("No table to export.", true);
    const lines = [...tableEl.querySelectorAll("tr")].filter((row) => !row.hidden).map((row) => [...row.children].map((cell) => `"${cell.innerText.replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${route.replace(/\//g, "-")}.csv`; link.click(); URL.revokeObjectURL(link.href); toast("CSV exported from visible local rows.");
  }
  function exportReportCsv(kind) {
    const studentName = (id) => student(id)?.name || "";
    const batchName = (id) => batch(id)?.name || "";
    const courseName = (id) => course(id)?.name || "";
    let filename = "", records = [];
    if (kind === "students") {
      filename = "my-jee-mentor-students.csv";
      records = [["Admission number", "Name", "Email", "Phone", "Course", "Batch", "Subjects", "Admission date", "Status"], ...data.students.map((item, index) => [item.admissionNo || `ADM-${(item.admissionDate || today).slice(0, 4)}-${String(index + 1).padStart(4, "0")}`, item.name, item.email, item.phone, courseName(item.courseId), batchName(item.batchId), (item.subjects || []).join("; "), item.admissionDate, item.status || "Active"])];
    } else if (kind === "fees") {
      filename = "my-jee-mentor-fees.csv";
      records = [["Student", "Fee", "Total", "Paid", "Balance", "Due date"], ...data.fees.map((item) => [studentName(item.studentId), item.title, Number(item.total || 0), Number(paid(item.id) || 0), Number(balance(item.id) || 0), item.dueDate])];
    } else if (kind === "attendance") {
      filename = "my-jee-mentor-attendance.csv";
      records = [["Date", "Student", "Batch", "Status"], ...data.attendance.flatMap((day) => (day.records || []).map((record) => [day.date, studentName(record.studentId), batchName(day.batchId), record.status]))];
    } else return toast("This CSV export is not available.", true);
    const csvCell = (value) => {
      let text = String(value ?? "");
      if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = records.map((record) => record.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = filename; link.hidden = true; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`${records.length - 1} ${kind} record${records.length === 2 ? "" : "s"} exported.`);
  }
  function bindDialogSubmit() { dialogBody?.addEventListener("submit", submitForm); }
  dialog?.addEventListener("click", (event) => { if (event.target.matches("[data-action]")) handleAction(event.target.dataset.action); if (event.target.matches("[data-confirm-delete]")) deleteDemoRecord(event.target.dataset.confirmDelete); });
  dialog?.addEventListener("click", (event) => {
    const platform = event.target.closest("[data-live-platform]");
    if (platform) { liveClassPlatform = platform.dataset.livePlatform; updateLivePlatformNotice(); return; }
    const remove = event.target.closest("[data-confirm-live-delete]");
    if (remove) { const id = remove.dataset.confirmLiveDelete; commit("Live class removed from this browser.", (draft) => { draft.liveClasses = draft.liveClasses.filter((entry) => entry.id !== id); }); dialog.close(); }
    const removeStaff = event.target.closest("[data-confirm-staff-delete]");
    if (removeStaff) deleteStaffRecord(removeStaff.dataset.confirmStaffDelete);
  });
  dialog?.addEventListener("close", () => { dialogBody?.classList.remove("live-class-dialog"); dialog?.classList.remove("adm-dialog"); });
  dialog?.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
  root.addEventListener("submit", submitForm);
  dialogBody?.addEventListener("submit", submitForm);
  window.addEventListener("hashchange", render);
  render();
})();
