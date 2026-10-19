(() => {
  "use strict";
  const main = document.getElementById("apply-main");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const icon = (name) => {
    const paths = { user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.8a2 2 0 0 1-.6 1.7L7.7 9.5a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.7-.6l2.8.5a2 2 0 0 1 1.5 1.8z"/>', people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>', cap: '<path d="m2 10 10-5 10 5-10 5-10-5z"/><path d="M6 12v5c3.5 3 8.5 3 12 0v-5M22 10v6"/>', shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/>', send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.user}</svg>`;
  };
  let photoData = "";
  const section = (title, symbol, fields) => `<section class="apply-section"><h2>${icon(symbol)}${title}</h2><div class="apply-grid">${fields}</div></section>`;
  const field = (label, name, type = "text", { required = false, placeholder = "", options = "", wide = false, hint = "" } = {}) => `<label class="apply-field${wide ? " wide" : ""}" data-field="${name}"><span>${label}${required ? ' <em>*</em>' : ""}</span>${type === "select" ? `<select name="${name}" ${required ? "required" : ""}>${options}</select>` : type === "textarea" ? `<textarea name="${name}" placeholder="${escapeHtml(placeholder)}"></textarea>` : `<input name="${name}" type="${type}" ${required ? "required" : ""} placeholder="${escapeHtml(placeholder)}" ${name === "mobile" || name === "guardianPhone" ? 'inputmode="numeric" maxlength="10"' : ""} ${name === "photo" ? 'accept="image/jpeg,image/png,image/webp"' : ""}/>`}${name === "photo" ? '<img class="apply-photo-preview" data-photo-preview alt="Photo preview"/><small>JPG / PNG / WebP, max 5MB. Used as the student\'s profile picture once admission is approved.</small>' : hint ? `<small>${hint}</small>` : ""}<small class="apply-error" data-error></small></label>`;
  function closed(message = "Admissions are currently closed") {
    main.innerHTML = `<section class="apply-closed"><span class="apply-success-check" aria-hidden="true">!</span><h2>${escapeHtml(message)}</h2><p>Please contact the institute for current admission information.</p></section>`;
  }
  function renderForm(config, batches) {
    document.title = `Online Admission Application · ${config.instituteName}`;
    document.querySelector("[data-academic-year]").textContent = config.academicYear || "2026-2027";
    const batchOptions = batches.map((batch) => `<option value="${escapeHtml(batch.id)}">${escapeHtml(batch.course ? `${batch.course} - ${batch.name}` : batch.name)}</option>`).join("");
    main.innerHTML = `<form class="apply-form" novalidate>
      ${section("Student Information", "user", `${field("Full Name", "name", "text", { required: true, placeholder: "As per birth certificate" })}${field("Gender", "gender", "select", { required: true, options: '<option value="">Select</option><option>Male</option><option>Female</option><option>Other</option>' })}${field("Date of Birth", "dateOfBirth", "date")}${field("Applying for Course → Batch", "batchId", "select", { required: true, options: `<option value="">Select a batch...</option>${batchOptions}` })}`)}
      ${section("Contact Details", "phone", `${field("Mobile Number", "mobile", "tel", { required: true, placeholder: "10-digit mobile" })}${field("Email Address", "email", "email", { required: true, placeholder: "student@email.com" })}${field("Address", "address", "textarea", { wide: true, placeholder: "Current residential address" })}${field("Profile Photo (optional)", "photo", "file", { wide: true })}`)}
      ${section("Parent / Guardian Details", "people", `${field("Father's Name", "fatherName")}${field("Mother's Name", "motherName")}${field("Guardian's Phone", "guardianPhone", "tel", { placeholder: "10-digit mobile" })}`)}
      ${section("Academic Background", "cap", `${field("Previous School / Institution", "previousSchool")}${field("Last Year %", "previousYearPercent", "number", { placeholder: "0–100", hint: "Enter a value from 0 to 100." })}`)}
      <section class="apply-section"><h2>${icon("shield")}Declaration</h2><label class="apply-declaration"><input name="declaration" type="checkbox"/><span>I hereby confirm that all the information provided by me is true and correct to the best of my knowledge. I understand that any false or misleading information may result in rejection of my application.</span></label><small class="apply-error" data-declaration-error></small></section>
      <div class="apply-form-error" role="alert" aria-live="polite"></div><footer class="apply-footer"><span class="apply-secure">${icon("shield")} Your data is secure and encrypted</span><button class="apply-submit" type="submit">${icon("send")} Submit Application</button></footer>
    </form>`;
    const form = main.querySelector("form");
    form.elements.photo.addEventListener("change", async () => {
      const file = form.elements.photo.files[0], preview = main.querySelector("[data-photo-preview]");
      photoData = "";
      if (!file) { preview.style.display = "none"; return; }
      if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) { showError("photo", "Choose a JPG, PNG or WebP image under 5 MB."); form.elements.photo.value = ""; return; }
      photoData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
      preview.src = photoData; preview.style.display = "block";
    });
    form.addEventListener("input", (event) => event.target.closest("[data-field]")?.classList.remove("invalid"));
    form.addEventListener("submit", submit);
  }
  function showError(name, message) { const wrapper = main.querySelector(`[data-field="${CSS.escape(name)}"]`); wrapper?.classList.add("invalid"); const error = wrapper?.querySelector("[data-error]"); if (error) error.textContent = message; }
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget, errorBox = form.querySelector(".apply-form-error"), declarationError = form.querySelector("[data-declaration-error]");
    errorBox.textContent = "";
    form.querySelectorAll(".invalid").forEach((item) => item.classList.remove("invalid"));
    let firstError = null;
    const values = Object.fromEntries(new FormData(form).entries());
    if (!values.name?.trim()) { showError("name", "Enter the student's full name."); firstError ||= main.querySelector('[data-field="name"]'); }
    else if (values.name.trim().length < 2) { showError("name", "Enter at least 2 characters."); firstError ||= main.querySelector('[data-field="name"]'); }
    if (!values.gender) { showError("gender", "Select a gender."); firstError ||= main.querySelector('[data-field="gender"]'); }
    if (!values.batchId) { showError("batchId", "Select a course and batch."); firstError ||= main.querySelector('[data-field="batchId"]'); }
    if (!/^\d{10}$/.test(values.mobile || "")) { showError("mobile", "Enter a valid 10-digit mobile number."); firstError ||= main.querySelector('[data-field="mobile"]'); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email || "")) { showError("email", "Enter a valid email address."); firstError ||= main.querySelector('[data-field="email"]'); }
    if (values.previousYearPercent !== "" && (!Number.isFinite(Number(values.previousYearPercent)) || Number(values.previousYearPercent) < 0 || Number(values.previousYearPercent) > 100)) { showError("previousYearPercent", "Enter a percentage between 0 and 100."); firstError ||= main.querySelector('[data-field="previousYearPercent"]'); }
    if (!form.elements.declaration.checked) { declarationError.textContent = "Please accept the declaration to continue."; declarationError.style.display = "block"; firstError ||= declarationError; }
    if (firstError) { firstError.scrollIntoView({ behavior: "smooth", block: "center" }); firstError.querySelector?.("input,select,textarea")?.focus({ preventScroll: true }); return; }
    const button = form.querySelector("button[type=submit]"); button.disabled = true;
    try {
      const response = await fetch("/api/admissions/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, declaration: true, photo: photoData }) });
      const result = await response.json();
      if (!response.ok) { errorBox.textContent = result.error || "Could not submit the application."; button.disabled = false; return; }
      main.innerHTML = `<section class="apply-success"><span class="apply-success-check" aria-hidden="true">✓</span><h2>Application Submitted</h2><div class="apply-success-number">${escapeHtml(result.applicationNo)}</div><p>We will contact you on ${escapeHtml(result.mobile)} / ${escapeHtml(result.email)}.</p><button class="apply-again" type="button">Submit another application</button></section>`;
      main.querySelector(".apply-again").addEventListener("click", () => location.reload());
    } catch { errorBox.textContent = "Unable to reach the application service. Please try again."; button.disabled = false; }
  }
  async function init() {
    try {
      const [configResponse, batchResponse] = await Promise.all([fetch("/api/admissions/public/config"), fetch("/api/admissions/public/batches")]);
      if (!configResponse.ok || !batchResponse.ok) throw new Error("Admission service unavailable.");
      const config = await configResponse.json(), batches = await batchResponse.json();
      if (!config.open) return closed();
      renderForm(config, batches);
    } catch { closed("The admission form is temporarily unavailable"); }
  }
  init();
})();
