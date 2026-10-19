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
    staff: [{ id: "staff-anil", name: "Anil Kumar", email: "", phone: "", role: "Physics Teacher", employmentType: "Full-Time", status: "Active", salary: "" }],
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
  let cameraStream = null;

  function loadStore() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return clone(seed);
      const parsed = JSON.parse(saved);
      const keys = Object.keys(seed);
      if (!parsed || parsed.version !== 1 || keys.some((key) => !Array.isArray(parsed[key]) && key !== "version")) return clone(seed);
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
  function logo() { return `<div class="portal-logo"><svg class="portal-logo-mark" viewBox="0 0 40 40" aria-hidden="true"><path d="M10 9v22M10 13h20M10 29h20M29 7v8M21 13v8M29 25v8M10 21h11"/><circle cx="10" cy="9" r="3"/><circle cx="30" cy="9" r="3"/><circle cx="10" cy="31" r="3"/><circle cx="30" cy="31" r="3"/><circle cx="21" cy="21" r="3"/></svg><span><span class="portal-logo-name">Coach <b>Sutra</b></span><small>Scale Coaching. Simplify Everything.</small></span></div>`; }

  const navGroups = [
    ["Overview", [["Dashboard", "dashboard", "▦"], ["Academic Years", "academic-years", "▦"], ["Reports & Analytics", "reports", "▥"]]],
    ["People", [["Students", "students", "♟"], ["Staff", "staff", "♙"], ["Online Admissions", "admissions", "＋"], ["Lead CRM", "leads", "⌕"], ["Meta Lead Ads", "meta-leads", "↗"], ["Lead Nurturing", "lead-nurturing", "⌁"]]],
    ["Curriculum", [["Courses / Programs", "courses", "▦"], ["Subjects", "subjects", "▰"], ["Topics", "topics", "◆"], ["Batches", "batches", "▱"], ["Question Bank", "question-bank", "✎"], ["Test Series", "test-series", "◈"], ["Learning Materials", "materials", "▤"], ["Library", "library", "▤"]]],
    ["Academics", [["Timetable", "timetable", "▦"], ["Attendance", "attendance", "✓"], ["Homework", "homework", "✎"], ["Exams", "exams", "▤"], ["Offline Exams", "offline-exams", "▤"], ["Results & Report Cards", "results", "▥"], ["Certificates", "certificates", "◇"], ["ID Cards", "id-cards", "▧"], ["Video Lectures", "video-lectures", "▶"], ["Live Classes", "live-classes", "◉"], ["Parent-Teacher Meetings", "ptm", "♧"]]],
    ["Finance", [["Smart Billing Hub", "billing", "₹"], ["Fee Collection", "fees", "₹"], ["Fee Structures", "fee-structures", "₹"], ["Discounts & Coupons", "discounts", "%"], ["Payment Reminders", "payment-reminders", "♧"], ["Payment History", "payments", "▤"], ["Expenses & Income", "expenses", "₹"], ["Payroll", "payroll", "₹"], ["Staff Attendance", "staff-attendance", "✓"], ["Payslips", "payslips", "▤"]]],
    ["Communication", [["Bulk Communication", "broadcast", "◉"], ["Messages Inbox", "messages", "☏"]]],
    ["Account", [["Settings", "settings", "⚙"], ["My Profile", "profile", "♙"]]]
  ];
  const pageTitles = Object.fromEntries(navGroups.flatMap(([, items]) => items.map(([label, id]) => [id, label])));
  function studentNavIcon(id) {
    const paths = { dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', "academic-years": '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4m10-4v4M3 9h18M7 13h3m-3 4h3m4-4h3m-3 4h3"/>', reports: '<path d="M4 19V5m0 14h17M8 16v-4m5 4V8m5 8V4"/>', students: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1zm12-9a3 3 0 1 0-1-5.8M17 14a5 5 0 0 1 4 5v1h-3"/>', staff: '<circle cx="12" cy="8" r="3"/><path d="M5 20v-1a7 7 0 0 1 14 0v1zM4 5h3m10 0h3"/>', admissions: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>', courses: '<path d="m3 9 9-5 9 5-9 5zM6 11v6c4 3 8 3 12 0v-6m3-2v7"/>', subjects: '<path d="M4 5c3-2 6-1 8 1v15c-2-2-5-3-8-1zm16 0c-3-2-6-1-8 1v15c2-2 5-3 8-1z"/>', topics: '<path d="m4 7 4-4 4 4-4 4zM14 5h7M14 10h7M4 16h17M4 20h13"/>', batches: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="M7 6V3h10v3M3 11h18"/>', "question-bank": '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>' };
    const path = paths[id] || '<circle cx="12" cy="12" r="8"/><path d="M12 8v8m-4-4h8"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }

  function shell() {
    const active = route.split("/")[0];
    const isStudents = route === "students" || route === "students/new";
    root.innerHTML = `${isStudents ? "" : `<div class="dev-ribbon">LOCAL DEMO · BROWSER DATA</div>`}<div class="workspace${isStudents ? " students-layout" : ""}">
      <aside class="sidebar"><div class="side-brand">${logo()}</div><label class="side-search"><span>⌕</span><input id="menu-search" type="search" placeholder="Search menu…" aria-label="Search menu" /></label><nav class="side-nav">${navGroups.map(([group, items]) => `<section class="nav-group"><div class="nav-group-title"><span>${group}</span><span>⌄</span></div>${items.map(([label, id, icon]) => `<a class="nav-item ${active === id || (id === "students" && active === "student") || (id === "fees" && active === "fee") ? "active" : ""}" href="#${id}" data-route="${id}" data-label="${label.toLowerCase()}"><span class="nav-icon">${isStudents ? studentNavIcon(id) : icon}</span><span>${label}</span></a>`).join("")}</section>`).join("")}</nav><button class="side-profile" data-route="profile"><span class="profile-avatar">${isStudents ? "DE" : "AD"}</span><span><b>${isStudents ? "Deepak" : "Ananya Sharma"}</b><small>${isStudents ? "Institute Admin" : "Institute Admin · Local demo"}</small></span><span class="profile-caret">⌄</span></button></aside><div class="side-backdrop" data-close-sidebar></div>
      <header class="topbar"><button class="top-toggle" aria-label="Toggle navigation" data-toggle-sidebar>☰</button><div class="top-title">${isStudents ? "Academics / Students" : esc(titleForRoute())}</div>${isStudents ? `<span class="student-plan-notice">⚠ Plan expires in 6 days</span>` : `<span class="admin-plan-notice">LOCAL PREVIEW</span>`}<label class="top-search"><span>⌕</span><input id="global-search" type="search" placeholder="Search students, leads, fees…" aria-label="Search visible records" /></label><button class="top-icon-btn" data-action="notifications" aria-label="Notifications">♧</button><button class="top-icon-btn" data-action="settings" aria-label="Settings">⚙</button><button class="top-icon-btn" data-action="logout" aria-label="Log out">⇥</button></header>
      <main class="main-area" id="main-area">${renderPage()}</main><footer class="page-footer"><span>${isStudents ? "© 2026 JEE Mentor" : "© 2026 JEE Mentor · Local prototype"}</span><span>${isStudents ? "Coach Sutra v3.0" : "Coach Sutra inspired · No service connections"}</span></footer></div>`;
    bindShell();
  }
  function titleForRoute() { const id = route.split("/")[0]; return pageTitles[id] || (id === "student" ? "Student Profile" : id === "fee" ? "Assign Fee" : "Dashboard"); }
  function bindShell() {
    root.querySelectorAll("[data-route]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); go(link.dataset.route); }));
    root.querySelector("[data-toggle-sidebar]")?.addEventListener("click", () => { root.querySelector(".sidebar")?.classList.toggle("open"); root.querySelector(".side-backdrop")?.classList.toggle("open"); });
    root.querySelector("[data-close-sidebar]")?.addEventListener("click", () => { root.querySelector(".sidebar")?.classList.remove("open"); root.querySelector(".side-backdrop")?.classList.remove("open"); });
    root.querySelector("#menu-search")?.addEventListener("input", (event) => { const value = event.target.value.toLowerCase(); root.querySelectorAll(".nav-item").forEach((link) => { link.hidden = !link.dataset.label.includes(value); }); });
    root.querySelector("#global-search")?.addEventListener("input", (event) => filterRows(event.target.value));
    root.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
    root.querySelectorAll("[data-open-form]").forEach((button) => button.addEventListener("click", () => go(button.dataset.openForm)));
    root.querySelectorAll("[data-dialog-action]").forEach((button) => button.addEventListener("click", () => handleDialogAction(button.dataset.dialogAction, button.dataset.id || "")));
    root.querySelectorAll("[data-report]").forEach((button) => button.addEventListener("click", () => { selectedReport = button.dataset.report; go("reports/view"); }));
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
    root.querySelectorAll("[data-report]").forEach((button) => button.addEventListener("click", () => { selectedReport = button.dataset.report; go("reports/view"); }));
    root.querySelectorAll("[data-thread]").forEach((button) => button.addEventListener("click", () => { selectedThread = button.dataset.thread; render(); }));
    root.querySelectorAll("[data-filter-course], #student-filter-course, #student-filter-batch").forEach((control) => control.addEventListener("change", filterStudents));
    root.querySelectorAll("[data-live-filter]").forEach((button) => button.addEventListener("click", () => { liveClassFilter = button.dataset.liveFilter; render(); }));
    root.querySelectorAll("[data-live-platform-open]").forEach((button) => button.addEventListener("click", () => { showLiveClassDialog(); liveClassPlatform = button.dataset.livePlatformOpen; updateLivePlatformNotice(); }));
    root.querySelectorAll("[data-live-action]").forEach((button) => button.addEventListener("click", () => handleLiveClassAction(button.dataset.liveAction, button.dataset.id || "")));
    root.querySelectorAll("[data-student-action]").forEach((button) => button.addEventListener("click", () => handleStudentAction(button.dataset.studentAction, button.dataset.id)));
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

  function render() { route = readRoute(); if (route !== "students/new" && cameraStream) { cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; } shell(); }
  function renderPage() {
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
    if (route === "staff/new") return staffForm();
    if (route === "leads") return leadsPage();
    if (route === "leads/new") return leadForm();
    if (route === "meta-leads") return metaLeadPage();
    if (route === "lead-nurturing") return nurturingPage();
    if (route === "billing") return billingPage();
    if (route === "live-classes") return liveClassesPage();
    if (route === "live-classes/new") return liveClassForm();
    if (route === "reports") return reportsPage();
    if (route === "reports/view") return reportView();
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
      <nav class="admin-quick-actions" aria-label="Dashboard shortcuts">${[["Add Student","♟","students/new"],["New Exam","▤","exams/new"],["Attendance","✓","attendance"],["Fees","₹","fees/assign"],["Broadcast","◉","broadcast"],["Homework","✎","homework/new"],["Lead CRM","⌕","leads"],["Reports","▥","reports"]].map(([label, icon, link]) => `<a class="admin-shortcut" href="#${link}" data-route="${link}"><span>${icon}</span><b>${label}</b></a>`).join("")}</nav>
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

    const width = 900, height = 230, left = 42, right = 16, top = 14, bottom = 42;
    const plotWidth = width - left - right, plotHeight = height - top - bottom;
    const max = Math.max(1, ...values);
    const points = values.map((value, index) => ({
      x: left + plotWidth * index / Math.max(1, values.length - 1),
      y: top + plotHeight * (1 - value / max)
    }));
    const path = points.map((point, index) => {
      if (index === 0) return `M ${point.x} ${point.y}`;
      const previous = points[index - 1], before = points[index - 2] || previous, next = points[index + 1] || point;
      const control1x = previous.x + (point.x - before.x) / 6;
      const control1y = previous.y + (point.y - before.y) / 6;
      const control2x = point.x - (next.x - previous.x) / 6;
      const control2y = point.y - (next.y - previous.y) / 6;
      return `C ${control1x} ${control1y}, ${control2x} ${control2y}, ${point.x} ${point.y}`;
    }).join(" ");
    const baseline = height - bottom;
    const fillPath = `${path} L ${points[points.length - 1].x} ${baseline} L ${points[0].x} ${baseline} Z`;
    const tickStep = max <= 4 ? 1 : Math.ceil(max / 4);
    const ticks = Array.from(new Set([...Array.from({ length: Math.floor(max / tickStep) + 1 }, (_, index) => index * tickStep), max])).sort((a, b) => a - b);
    const grid = ticks.map((tick) => {
      const y = top + plotHeight * (1 - tick / max);
      return `<line class="admin-chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="admin-chart-y" x="${left - 11}" y="${y + 4}" text-anchor="end">${tick}</text>`;
    }).join("");
    const labels = intervals.map(({ label }, index) => `<text class="admin-chart-x" x="${points[index].x}" y="${height - 10}" text-anchor="middle">${esc(label)}</text>`).join("");
    const circles = points.map((point) => `<circle class="admin-chart-point" cx="${point.x}" cy="${point.y}" r="3.6"/>`).join("");
    return `<svg class="admin-line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${esc(period)} student admissions trend: ${values.reduce((sum, value) => sum + value, 0)} students in the displayed period"><title>${esc(period)} student enrollment trend</title><desc>Admissions are counted from each student's saved admission date.</desc>${grid}<path class="admin-chart-area" d="${fillPath}"/><path class="admin-chart-line" d="${path}"/>${circles}${labels}</svg>`;
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
  function batchForm() { return formPage("Create New Batch", "Select existing course, academic year and staff records.", "batch", section("Batch details", "Only records already in this local demo are selectable.", field("Batch name", "name", "text", { required: true }) + field("Course / program", "courseId", "select", { required: true, choices: data.courses.map((item) => [item.id, item.name]) }) + field("Academic year", "academicYearId", "select", { required: true, choices: data.academicYears.map((item) => [item.id, item.name]) }) + field("Teacher", "teacherId", "select", { choices: [["", "Unassigned"], ...data.staff.map((item) => [item.id, item.name])] }) + field("Weekly schedule", "schedule", "text", { placeholder: "e.g. Monday, Wednesday, Friday" }) + field("Status", "status", "select", { value: "Active", choices: [["Active", "Active"], ["Archived", "Archived"]] }))); }

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
      return `<tr data-student-row data-filter-row data-batch="${esc(item.batchId || "")}" data-status="${esc(item.status || "Active")}" data-search="${esc(searchText)}" data-admission="${esc(admission)}" data-name="${esc(item.name.toLowerCase())}"><td><div class="students-person"><i>${esc((item.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</i><span><b>${esc(item.name)}</b><small>${esc(item.email || item.phone || item.roll || "Student")}</small></span></div></td><td><span class="admission-badge">${esc(admission)}</span></td><td><b>${esc(selectedBatch?.name || "Unassigned")}</b><small class="students-subtext">${esc(course(item.courseId)?.name || "—")}</small></td><td>${esc(item.subjects?.join(", ") || "—")}</td><td><div class="attendance-cell"><span><i style="width:${Math.max(0, Math.min(100, rate))}%"></i></span><b>${rate}%</b></div></td><td><b class="fee-value">${money(due)}</b><small class="fee-state ${due === 0 ? "paid" : dueSoon ? "upcoming" : "due"}">${due === 0 ? "PAID" : dueSoon ? "UPCOMING" : "DUE"}</small></td><td><span class="risk-pill ${risk.toLowerCase()}"><i></i>${esc(risk)}</span></td><td><span class="student-status ${String(item.status || "Active").toLowerCase()}">${esc(item.status || "Active")}</span></td><td><div class="students-row-actions"><button aria-label="View ${esc(item.name)} profile" title="View profile" data-route="student/${esc(item.id)}">${studentActionIcon("view")}</button><button aria-label="Edit ${esc(item.name)}" title="Edit student" data-student-action="edit" data-id="${esc(item.id)}">${studentActionIcon("edit")}</button><button class="transfer" aria-label="Transfer or update ${esc(item.name)}" title="Transfer / status" data-student-action="transfer" data-id="${esc(item.id)}">${studentActionIcon("transfer")}</button></div></td></tr>`;
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
  function staffPage() { const rows = data.staff.map((item) => `<tr data-filter-row><td>${personCell(item.name, item.email)}</td><td>${esc(item.role)}</td><td>${esc(item.employmentType)}</td><td>${item.salary ? money(item.salary) : "Not provided"}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`); return `${pageHeading("Staff Directory", "Manage staff records. Payroll calculations and payslips are deferred.", button("＋ Add Staff", "staff/new"))}<div class="summary-row">${statCard("Staff records", data.staff.length)}${statCard("Full-time", data.staff.filter((item) => item.employmentType === "Full-Time").length, "green")}${statCard("Payroll", "Not connected", "orange")}</div>${table("Staff", ["Name", "Role", "Employment type", "Monthly salary", "Status"], rows)}`; }
  function staffForm() { return formPage("Add New Staff", "Staff details stay in this browser. Salary is recorded as an optional reference only.", "staff", section("Account information", "Do not enter passwords or sensitive payroll details.", field("Full name", "name", "text", { required: true }) + field("Email", "email", "email") + field("Phone", "phone", "tel") + field("Role / designation", "role", "text", { required: true })) + section("Employment details", "Employment types match the options visible in the reference.", field("Employment type", "employmentType", "select", { required: true, choices: [["Full-Time", "Full-Time"], ["Contractual", "Contractual"], ["Part-Time", "Part-Time"], ["Hourly", "Hourly"]] }) + field("Monthly salary (₹)", "salary", "number", { min: "0", step: "1", help: "Optional demo reference only; no payroll is calculated." }) + field("Status", "status", "select", { value: "Active", choices: [["Active", "Active"], ["Inactive", "Inactive"]] }))); }

  function leadsPage() { const rows = data.leads.map((item) => `<tr data-filter-row>${personCell(item.name, item.phone || item.email)}<td>${esc(item.course || "—")}</td><td>${esc(item.source || "Manual demo")}</td><td><span class="tag">${esc(item.status)}</span></td><td>${dateLabel(item.createdAt)}</td></tr>`); return `${pageHeading("Lead CRM", "Track local demo inquiries. No external lead source is connected.", button("＋ Add Lead", "leads/new"))}<div class="summary-row">${statCard("All inquiries", data.leads.length)}${statCard("New", data.leads.filter((item) => item.status === "New").length, "green")}${statCard("Converted", data.leads.filter((item) => item.status === "Converted").length, "orange")}</div>${table("Inquiries", ["Lead", "Interested course", "Source", "Status", "Created"], rows)}`; }
  function leadForm() { return formPage("Add Lead", "Create a local inquiry record. No message is sent.", "lead", section("Contact and inquiry", "Contact details are optional demo inputs.", field("Name", "name", "text", { required: true }) + field("Phone", "phone", "tel") + field("Email", "email", "email") + field("Interested course", "course", "select", { choices: data.courses.map((item) => [item.name, item.name]) }) + field("Source", "source", "select", { value: "Manual demo", choices: [["Manual demo", "Manual demo"], ["Website inquiry", "Website inquiry"], ["Referral", "Referral"]] }) + field("Status", "status", "select", { value: "New", choices: [["New", "New"], ["Contacted", "Contacted"], ["Converted", "Converted"], ["Closed", "Closed"]] }))); }
  function metaLeadPage() { return `${pageHeading("Meta Lead Ads Integration", "Mock setup screen. No credentials are requested and no external connection is made.")}<div class="admin-integration-grid"><article class="panel admin-integration-card"><div class="integration-icon">f</div><div><h2>Meta Lead Ads</h2><p>Connect status: <b class="status-disconnected">Not connected</b></p><p>This prototype does not connect to Meta or send lead data.</p><button class="secondary-action" data-action="meta-checklist">View setup checklist</button></div></article><article class="panel admin-integration-card"><h2>Local preview controls</h2><p>Use Lead CRM to add sample inquiries. Integration credentials, permissions and sync behavior require an approved service configuration.</p>${button("Open Lead CRM", "leads", "outline-action")}</article></div>`; }
  function nurturingPage() { return `${pageHeading("Lead Nurturing Automation", "Sequences are preview-only; no emails, SMS or WhatsApp messages are sent.", `<button class="primary-action" data-action="new-sequence">＋ Create Sequence</button>`)}<div class="summary-row">${statCard("Sequences", data.sequences.length)}${statCard("Active", data.sequences.filter((item) => item.status === "Draft").length, "green")}${statCard("Contacts", data.leads.length, "orange")}</div><section class="admin-module-grid"><article class="panel admin-feature-card"><h2>Inquiry follow-up</h2><p>Draft a local reminder sequence for new inquiries.</p><span class="tag warning">Draft only</span></article><article class="panel admin-feature-card"><h2>Course interest follow-up</h2><p>Preview a course-specific follow-up plan.</p><span class="tag">Not connected</span></article></section>${data.sequences.length ? table("Saved local sequences", ["Name", "Audience", "Status"], data.sequences.map((item) => `<tr data-filter-row><td>${esc(item.name)}</td><td>${esc(item.audience)}</td><td>${esc(item.status)}</td></tr>`)) : empty("No sequences created", "Create a local draft to explore this screen.")}`; }
  function admissionsPage() { return `${pageHeading("Online Admissions", "Public forms and application submissions are not connected.", button("＋ Admit Student", "students/new"))}<section class="panel admin-deferred-card"><span>＋</span><h2>Applications appear here when added locally</h2><p>Use Admit Student to create a demo student. This prototype has no public application portal.</p></section>`; }

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
  function liveClassForm() { return formPage("Schedule Live Class", "This preview saves a local schedule only; it does not create a meeting room or contact a provider.", "live-class", section("Session details", "Add the class information and, if available, paste a meeting link.", field("Session title", "title", "text", { required: true }) + field("Platform", "platform", "select", { required: true, value: "jitsi", choices: [["jitsi", "Jitsi Meet"], ["zoom", "Zoom"], ["meet", "Google Meet"], ["teams", "Microsoft Teams"], ["custom", "Custom link"]] }) + field("Topic", "topic") + field("Teacher", "teacherId", "select", { required: true, choices: data.staff.map((item) => [item.id, item.name]) }) + field("Subject", "subject") + field("Batch", "batchId", "select", { choices: data.batches.map((item) => [item.id, item.name]) }) + field("Date", "date", "date", { required: true, value: today }) + field("Start time", "time", "time", { required: true }) + field("Duration (minutes)", "duration", "number", { required: true, min: "1", value: "60" }) + field("Meeting URL", "meetingUrl", "url", { placeholder: "Paste the URL created in your video platform" }) + field("Daily recurring class", "daily", "checkbox") + field("Notes", "notes", "textarea", { wide: true }))); }
  function showLiveClassDialog(itemId = "") {
    liveClassPlatform = "jitsi";
    const item = itemId ? data.liveClasses.find((record) => record.id === itemId) : null;
    if (item) liveClassPlatform = item.platform || "jitsi";
    const batchChoices = [["all", "All Batches"], ...data.batches.map((record) => [record.id, record.name])];
    const platforms = [["jitsi", "▣", "Jitsi Meet", "Free · meeting link can be pasted"], ["zoom", "▣", "Zoom", "Provider integration required"], ["meet", "▣", "Google Meet", "Paste a link from Google Calendar"], ["teams", "▣", "Teams", "Provider integration required"], ["custom", "↗", "Custom Link", "Any meeting URL"]];
    const content = `<div class="live-class-dialog-shell"><div class="live-platform-picker" role="group" aria-label="Video platform">${platforms.map(([id, icon, label, sub]) => `<button type="button" class="live-platform-option ${liveClassPlatform === id ? "selected" : ""}" data-live-platform="${id}" aria-pressed="${liveClassPlatform === id}"><span>${icon}</span><b>${label}</b><small>${sub}</small>${["zoom", "teams"].includes(id) ? `<em>Configure first</em>` : ""}</button>`).join("")}</div><div class="live-platform-notice" id="live-platform-notice" role="status"></div><form class="live-class-form" data-admin-form="live-class" data-edit-id="${esc(item?.id || "")}" novalidate>
      ${field("Class title", "title", "text", { required: true, value: item?.title || "", placeholder: "e.g. JEE Physics — Electrostatics Revision", wide: true })}
      <div class="live-form-grid">${field("Topic", "topic", "text", { value: item?.topic || "", placeholder: "Specific topic for today" })}${field("Teacher", "teacherId", "select", { required: true, value: item?.teacherId || "", choices: data.staff.map((record) => [record.id, record.name]) })}${field("Subject", "subject", "text", { value: item?.subject || "", placeholder: "Choose or enter a subject" })}${field("Batch", "batchId", "select", { value: item?.batchId || "all", choices: batchChoices })}${field("Date & Time", "scheduledAt", "datetime-local", { required: true, value: item ? `${item.date}T${item.time || "10:00"}` : `${today}T10:00` })}${field("Duration (minutes)", "duration", "number", { required: true, min: "1", step: "1", value: item?.duration || "60" })}${field("Meeting URL", "meetingUrl", "url", { value: item?.meetingUrl || "", placeholder: "Paste the meeting link from your provider", wide: true })}</div>
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
  function reportsPage() { const reports = [["Student Progress Report", "Student", "Progress, attendance and course overview"], ["Student Data Report", "Student", "Directory and academic assignments"], ["Attendance Report", "Attendance", "Saved attendance by date and batch"], ["Fee Collection Report", "Payments", "Collected, assigned and outstanding totals"], ["Top Performers", "Student", "Students ranked by recorded attendance score (demo proxy)"], ["Teacher Performance", "Staff", "Staff directory summary; no payroll calculation"], ["Payroll Report", "Staff", "Deferred · no payroll rules supplied"], ["Admission Report", "Student", "Students grouped by admission date"], ["Exam Results", "Exams", "Exam records and configured marks"], ["Transaction Report", "Payments", "Recorded local demo payments"], ["Income & Expense", "Finance", "Deferred · expense records are not modeled"]]; return `${pageHeading("Reports & Analytics", "Local report catalogue. Figures are calculated from Admin demo records.")}<section class="admin-report-grid">${reports.map(([name, type, details]) => `<button class="panel admin-report-card" data-report="${type}" ${type === "Staff" && name === "Payroll Report" ? "" : ""}><span>▥</span><b>${esc(name)}</b><small>${esc(details)}</small><i>Open report →</i></button>`).join("")}</section>`; }
  function reportView() { const type = selectedReport || "Student"; const map = { Student: ["Student", "Course", "Batch", "Attendance"], Attendance: ["Date", "Student", "Batch", "Status"], Payments: ["Date", "Student", "Fee", "Amount", "Method"], Exams: ["Exam", "Mode", "Date", "Max marks"], Staff: ["Staff", "Role", "Employment type", "Status"] }; let rows = [];
    if (type === "Student") rows = data.students.map((item) => `<tr data-filter-row><td>${esc(item.name)}</td><td>${esc(course(item.courseId)?.name || "—")}</td><td>${esc(batch(item.batchId)?.name || "—")}</td><td>${Number(item.attendance || 0)}%</td></tr>`);
    if (type === "Payments") rows = data.payments.map((item) => `<tr data-filter-row><td>${dateLabel(item.date)}</td><td>${esc(student(item.studentId)?.name || "—")}</td><td>${esc(fee(item.feeId)?.title || "—")}</td><td>${money(item.amount)}</td><td>${esc(item.method)}</td></tr>`);
    if (type === "Attendance") rows = data.attendance.flatMap((day) => day.records.map((record) => `<tr data-filter-row><td>${dateLabel(day.date)}</td><td>${esc(student(record.studentId)?.name || "—")}</td><td>${esc(batch(day.batchId)?.name || "—")}</td><td>${esc(record.status)}</td></tr>`));
    if (type === "Exams") rows = data.exams.map((item) => `<tr data-filter-row><td>${esc(item.title)}</td><td>${esc(item.mode)}</td><td>${dateLabel(item.date)}</td><td>${esc(item.maxMarks)}</td></tr>`);
    if (type === "Staff") rows = data.staff.map((item) => `<tr data-filter-row><td>${esc(item.name)}</td><td>${esc(item.role)}</td><td>${esc(item.employmentType)}</td><td>${esc(item.status)}</td></tr>`);
    return `${pageHeading(`${type} Report`, "Generated from local records currently stored in this browser.", button("← Reports", "reports", "secondary-action"))}${table(`${type} data`, map[type] || map.Student, rows, `<button class="secondary-action" data-export>Export CSV</button>`)}`;
  }
  function ptmPage() { const rows = data.ptmSessions.map((item) => `<tr data-filter-row><td>${esc(item.title)}</td><td>${dateLabel(item.date)} · ${esc(item.time)}</td><td>${esc(item.teacherName || "Not assigned")}</td><td>${esc(item.audience || "Parents")}</td><td><span class="tag">${esc(item.status)}</span></td></tr>`); return `${pageHeading("Parent-Teacher Meetings", "Schedule a local PTM record. No booking notification is sent.", button("＋ Schedule PTM Session", "ptm/new"))}${table("PTM sessions", ["Session", "Date & time", "Teacher", "Audience", "Status"], rows)}`; }
  function ptmForm() { return formPage("Schedule PTM Session", "Save a local meeting schedule preview.", "ptm", section("Session details", "Confirm the time and teacher with your institute before sharing.", field("Session title", "title", "text", { required: true }) + field("Date", "date", "date", { required: true }) + field("Start time", "time", "time", { required: true }) + field("Teacher", "teacherId", "select", { choices: data.staff.map((item) => [item.id, item.name]) }) + field("Audience", "audience", "select", { value: "Parents", choices: [["Parents", "Parents"], ["Students and parents", "Students and parents"]] }) + field("Notes", "notes", "textarea", { wide: true }))); }
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
  function deferredPage(id) { const labels = { results: "Results & Report Cards", marks: "Marks", expenses: "Expenses & Income", payroll: "Payroll & Payslips", salary: "Staff Salary", library: "Library Management", certificates: "Certificates", "id-cards": "ID Cards", materials: "Learning Materials", subjects: "Subject Management", topics: "Topic Management", "fee-structures": "Fee Structures", discounts: "Discounts & Coupons", "payment-reminders": "Payment Reminders", "staff-attendance": "Staff Attendance", payslips: "Staff Payslips", "video-lectures": "Video Lectures" }; const label = labels[id] || (pageTitles[id] || id.replace(/-/g, " ")); return `${pageHeading(label, "This module was identified in the reference scope. Its detailed workflow is not implemented in this UI-only phase.")}<section class="panel admin-deferred-card"><span class="tag warning">Deferred module</span><h2>${esc(label)} is not connected</h2><p>Records, calculation rules and actions for this module require a separate implementation phase. No placeholder actions will change data.</p>${button("Back to dashboard", "dashboard", "secondary-action")}</section>`; }

  function readForm(form) { return Object.fromEntries(new FormData(form).entries()); }
  function formError(form, message) { const slot = form.querySelector(".admin-form-error"); if (slot) slot.textContent = message; const submit = form.querySelector("[type=submit]"); if (submit) submit.disabled = false; if (!slot) toast(message, true); }
  function validForm(form) { if (!form.reportValidity()) return false; const slot = form.querySelector(".admin-form-error"); if (slot) slot.textContent = ""; return true; }
  async function submitForm(event) {
    const form = event.target.closest("form[data-admin-form]"); if (!form) return;
    event.preventDefault(); const type = form.dataset.adminForm; if (type !== "student" && !validForm(form)) return;
    const values = readForm(form), submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = true;
    const finish = (ok, message, destination = "") => { if (!ok) { if (submit) submit.disabled = false; return; } if (dialog?.open) dialog.close(); if (destination) { location.hash = destination; } };
    const add = (collection, record, label, destination) => finish(commit(label, (draft) => draft[collection].push(record)), label, destination);
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
  function bindDialogSubmit() { dialogBody?.addEventListener("submit", submitForm); }
  dialog?.addEventListener("click", (event) => { if (event.target.matches("[data-action]")) handleAction(event.target.dataset.action); if (event.target.matches("[data-confirm-delete]")) deleteDemoRecord(event.target.dataset.confirmDelete); });
  dialog?.addEventListener("click", (event) => {
    const platform = event.target.closest("[data-live-platform]");
    if (platform) { liveClassPlatform = platform.dataset.livePlatform; updateLivePlatformNotice(); return; }
    const remove = event.target.closest("[data-confirm-live-delete]");
    if (remove) { const id = remove.dataset.confirmLiveDelete; commit("Live class removed from this browser.", (draft) => { draft.liveClasses = draft.liveClasses.filter((entry) => entry.id !== id); }); dialog.close(); }
  });
  dialog?.addEventListener("close", () => dialogBody?.classList.remove("live-class-dialog"));
  dialog?.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
  root.addEventListener("submit", submitForm);
  dialogBody?.addEventListener("submit", submitForm);
  window.addEventListener("hashchange", render);
  render();
})();
