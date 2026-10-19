(() => {
  const app = document.getElementById('app');
  const api = async (path, payload = {}) => {
    const response = await fetch(path, { method: path.endsWith('/me') ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(path.endsWith('/me') ? {} : { body: JSON.stringify(payload) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
    return result;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const panel = (title, message, body) => `<main class="login-screen"><section class="auth-card"><div class="auth-kicker">COACH SUTRA ACCOUNT</div><h1>${title}</h1><p>${message}</p>${body}<div class="auth-foot">Local prototype. Use the OTP shown here only while demo email delivery is unconfigured.</div></section></main>`;
  const setError = message => { const slot = app.querySelector('[data-auth-error]'); if (slot) slot.textContent = message; };
  const busy = value => { const button = app.querySelector('[type=submit]'); if (button) button.disabled = value; };
  const demoNotice = (result) => result.demoMode && result.demoOtp ? `<p class="auth-demo-code" role="status">Demo mode: OTP shown here because email service is not connected. Code: <b>${esc(result.demoOtp)}</b>.</p>` : `<p class="auth-demo-code" role="status">If the email is registered, an OTP has been sent. It expires in 10 minutes.</p>`;
  const otpFields = `<div class="auth-otp-boxes" aria-label="6-digit one-time password">${Array.from({ length: 6 }, (_, index) => `<input data-otp-digit type="text" inputmode="numeric" autocomplete="${index ? 'off' : 'one-time-code'}" maxlength="1" aria-label="OTP digit ${index + 1}" />`).join('')}</div><input type="hidden" name="code" /><div class="auth-otp-status"><span data-otp-countdown>10:00 remaining</span><span data-otp-cooldown></span></div>`;
  const passwordRules = `<div class="auth-strength"><span data-strength-bar></span></div><ul class="auth-password-rules"><li data-password-rule="length">At least 8 characters</li><li data-password-rule="upper">Uppercase and lowercase letters</li><li data-password-rule="number">A number</li><li data-password-rule="symbol">A symbol</li><li data-password-rule="different">Different from the initial password</li><li data-password-rule="match">Passwords match</li></ul>`;
  const passwordFields = `<label>New password<input name="password" type="password" autocomplete="new-password" required minlength="8" /></label><label>Confirm password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" /></label>${passwordRules}`;
  let loginAccount = null;

  async function changePassword(account) {
    loginAccount = account;
    let challengeId = '';
    app.innerHTML = panel('Set a new password', `Welcome ${esc(account.name)}. Verify your email, then set a password to continue.`, `<div class="auth-flow"><div class="auth-flow-step" data-auth-step="request"><button class="auth-submit" data-send-first-code type="button">Send verification code</button></div><div class="auth-flow-step" data-auth-step="verify" hidden><div data-code-notice></div><form data-first-verify><label>6-digit email code${otpFields}</label><button class="auth-submit" type="submit">Verify code</button><button class="text-button" data-resend-first type="button">Resend OTP</button></form></div><div class="auth-flow-step" data-auth-step="password" hidden><form data-first-password>${passwordFields}<div class="auth-message" data-auth-error></div><button class="auth-submit" type="submit">Save password and continue</button></form></div><div class="auth-message" data-auth-error></div></div>`);
    app.querySelector('[data-send-first-code]').onclick = async () => { try { const result = await api('/api/auth/first-otp'); challengeId = result.challengeId; app.querySelector('[data-code-notice]').innerHTML = demoNotice(result); app.querySelector('[data-auth-step="request"]').hidden = true; app.querySelector('[data-auth-step="verify"]').hidden = false; bindOtp(app.querySelector('[data-first-verify]')); startOtpTimers(app.querySelector('[data-first-verify]'), app.querySelector('[data-resend-first]')); } catch (error) { setError(error.message); } };
    app.querySelector('[data-resend-first]').onclick = async () => { try { const result = await api('/api/auth/first-otp'); challengeId = result.challengeId; app.querySelector('[data-code-notice]').innerHTML = demoNotice(result); bindOtp(app.querySelector('[data-first-verify]')); startOtpTimers(app.querySelector('[data-first-verify]'), app.querySelector('[data-resend-first]')); } catch (error) { setError(error.message); } };
    app.querySelector('[data-first-verify]').onsubmit = async event => { event.preventDefault(); const code = new FormData(event.currentTarget).get('code'); if (!/^\d{6}$/.test(code)) return setError('Enter all six digits.'); busy(true); try { await api('/api/auth/verify-otp', { challengeId, code }); app.querySelector('[data-auth-step="verify"]').hidden = true; app.querySelector('[data-auth-step="password"]').hidden = false; } catch (error) { setError(error.message); } finally { busy(false); } };
    bindPasswordStrength(app.querySelector('[data-first-password]'));
    app.querySelector('[data-first-password]').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); if (values.password !== values.confirmPassword) return setError('Passwords do not match.'); if (!validPassword(values.password)) return setError('Use at least 8 characters with uppercase, lowercase, a number and a symbol.'); busy(true); try { await api('/api/auth/change-password', { ...values, challengeId }); sessionStorage.setItem('cs-auth-account', JSON.stringify({ ...account, mustChangePassword: false })); location.href = 'student.html'; } catch (error) { setError(error.message); } finally { busy(false); } };
  }
  const validPassword = value => value.length >= 8 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);

  async function forgotPassword(email = '') {
    let challengeId = '';
    app.innerHTML = panel('Reset your password', 'Enter your email address. If it is registered, we will send a one-time verification code.', `<div class="auth-flow"><form data-forgot-email><label>Email address<input name="email" type="email" autocomplete="email" required value="${esc(email)}" /></label><div class="auth-message" data-auth-error></div><button class="auth-submit" type="submit">Send code</button><button class="text-button" data-back-to-login type="button">Back to login</button></form><div data-forgot-next hidden><div data-code-notice></div><form data-forgot-verify><label>6-digit email code${otpFields}</label><button class="auth-submit" type="submit">Verify code</button><button class="text-button" data-resend-forgot type="button">Resend OTP</button></form><form data-reset-password hidden>${passwordFields}<div class="auth-message" data-auth-error></div><button class="auth-submit" type="submit">Save new password</button></form></div></div>`);
    app.querySelector('[data-back-to-login]').onclick = () => location.reload();
    app.querySelector('[data-forgot-email]').onsubmit = async event => { event.preventDefault(); busy(true); try { const result = await api('/api/auth/forgot', { email: new FormData(event.currentTarget).get('email') }); challengeId = result.challengeId || ''; app.querySelector('[data-code-notice]').innerHTML = `<p>If this email is registered, an OTP has been sent.</p>${demoNotice(result)}`; event.currentTarget.hidden = true; app.querySelector('[data-forgot-next]').hidden = false; bindOtp(app.querySelector('[data-forgot-verify]')); startOtpTimers(app.querySelector('[data-forgot-verify]'), app.querySelector('[data-resend-forgot]')); } catch (error) { setError(error.message); } finally { busy(false); } };
    app.querySelector('[data-resend-forgot]').onclick = async () => { const emailValue = app.querySelector('[data-forgot-email] [name=email]').value; try { const result = await api('/api/auth/forgot', { email: emailValue }); challengeId = result.challengeId || ''; app.querySelector('[data-code-notice]').innerHTML = `<p>If this email is registered, an OTP has been sent.</p>${demoNotice(result)}`; bindOtp(app.querySelector('[data-forgot-verify]')); startOtpTimers(app.querySelector('[data-forgot-verify]'), app.querySelector('[data-resend-forgot]')); } catch {} };
    app.querySelector('[data-forgot-verify]').onsubmit = async event => { event.preventDefault(); const code = new FormData(event.currentTarget).get('code'); if (!/^\d{6}$/.test(code)) return setError('Enter all six digits.'); busy(true); try { await api('/api/auth/verify-otp', { challengeId, code }); event.currentTarget.hidden = true; app.querySelector('[data-reset-password]').hidden = false; } catch (error) { setError(error.message); } finally { busy(false); } };
    bindPasswordStrength(app.querySelector('[data-reset-password]'));
    app.querySelector('[data-reset-password]').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); if (values.password !== values.confirmPassword) return setError('Passwords do not match.'); if (!validPassword(values.password)) return setError('Use at least 8 characters with uppercase, lowercase, a number and a symbol.'); busy(true); try { await api('/api/auth/reset-password', { ...values, challengeId }); app.innerHTML = panel('Password updated', 'Your password has been changed. Sign in with your new password.', `<a class="auth-submit" href="login.html">Return to login</a>`); } catch (error) { setError(error.message); } finally { busy(false); } };
  }
  function bindOtp(form) {
    if (!form) return;
    const boxes = [...form.querySelectorAll('[data-otp-digit]')], hidden = form.elements.namedItem('code');
    const sync = () => { hidden.value = boxes.map(box => box.value).join(''); };
    boxes.forEach((box, index) => {
      box.oninput = () => { box.value = box.value.replace(/\D/g, '').slice(-1); sync(); if (box.value && boxes[index + 1]) boxes[index + 1].focus(); };
      box.onkeydown = event => { if (event.key === 'Backspace' && !box.value && boxes[index - 1]) boxes[index - 1].focus(); };
      box.onpaste = event => { event.preventDefault(); const digits = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); boxes.forEach((item, i) => { item.value = digits[i] || ''; }); sync(); boxes[Math.min(digits.length, 5)]?.focus(); };
    });
  }
  function startOtpTimers(form, button) {
    if (!form) return;
    const end = Date.now() + 10 * 60 * 1000, cooldownEnd = Date.now() + 60 * 1000;
    const countdown = form.querySelector('[data-otp-countdown]'), cooldown = form.querySelector('[data-otp-cooldown]');
    const update = () => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000)), cool = Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000));
      if (countdown) countdown.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')} remaining`;
      if (cooldown) cooldown.textContent = cool ? `Resend available in ${cool}s` : '';
      if (button) button.disabled = cool > 0;
      if (!remaining || !form.isConnected) clearInterval(timer);
    };
    const timer = setInterval(update, 1000); update();
  }
  function bindPasswordStrength(form) {
    if (!form) return;
    const password = form.elements.namedItem('password'), confirm = form.elements.namedItem('confirmPassword'), bar = form.querySelector('[data-strength-bar]');
    const update = () => {
      const values = { length: password.value.length >= 8, upper: /[A-Z]/.test(password.value) && /[a-z]/.test(password.value), number: /\d/.test(password.value), symbol: /[^A-Za-z0-9]/.test(password.value), different: !Object.values({ student: 'JeemStudent@12345', parent: 'JeemParent@12345' }).includes(password.value), match: !!confirm.value && password.value === confirm.value };
      form.querySelectorAll('[data-password-rule]').forEach(item => item.classList.toggle('pass', values[item.dataset.passwordRule]));
      if (bar) bar.style.width = `${Object.values(values).filter(Boolean).length / 6 * 100}%`;
    };
    password.addEventListener('input', update); confirm.addEventListener('input', update); update();
  }

  document.addEventListener('submit', async event => {
    if (event.target.id !== 'login-form') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const values = Object.fromEntries(new FormData(event.target));
    const button = event.target.querySelector('[type=submit]'); button.disabled = true;
    try { const result = await api('/api/auth/login', values); if (result.account.mustChangePassword) return changePassword(result.account); sessionStorage.setItem('cs-auth-account', JSON.stringify(result.account)); location.href = result.account.role === 'student' || result.account.role === 'parent' ? 'student.html' : 'login.html'; }
    catch (error) { let slot = event.target.querySelector('[data-auth-error]'); if (!slot) { slot = document.createElement('div'); slot.dataset.authError = ''; slot.className = 'auth-message'; event.target.append(slot); } slot.textContent = error.message; if (!event.target.querySelector('[data-demo-workspaces]')) { const demo = document.createElement('button'); demo.type = 'button'; demo.dataset.demoWorkspaces = ''; demo.className = 'text-button'; demo.textContent = 'Explore Admin / Teacher local demo'; demo.onclick = () => { const roleButton = document.querySelector('[data-role="admin"]'); if (roleButton) roleButton.click(); else location.href = 'admin.html'; }; event.target.append(demo); } button.disabled = false; }
  }, true);
  document.addEventListener('click', event => { if (event.target.closest('[data-forgot]')) { event.preventDefault(); event.stopImmediatePropagation(); forgotPassword(document.querySelector('#login-form [name=email]')?.value || ''); } }, true);
  document.addEventListener('click', event => { if (event.target.closest('[aria-label="Log out"]')) { event.preventDefault(); api('/api/auth/logout').catch(() => {}).finally(() => { sessionStorage.removeItem('cs-auth-account'); location.href = 'login.html'; }); } }, true);

  if (document.body.dataset.portal === 'student' && app) {
    app.style.display = 'none';
    api('/api/auth/me').then(({ account }) => {
      if (!['student', 'parent'].includes(account.role)) { location.href = 'login.html'; return; }
      window.csCurrentAccount = account;
      if (account.mustChangePassword) { app.style.display = ''; changePassword(account); return; }
      app.style.display = ''; window.dispatchEvent(new CustomEvent('cs-auth-ready', { detail: account }));
    }).catch(() => { location.href = 'login.html'; });
  }
  if (document.body.dataset.portal === 'login') setTimeout(() => { const ribbon = document.querySelector('.dev-ribbon'); if (ribbon) ribbon.textContent = 'STUDENT / PARENT LOGIN · LOCAL DEMO'; const foot = document.querySelector('.auth-card .auth-foot'); if (foot) foot.textContent = 'Student and parent sign-in is enabled. Admin and teacher portals remain local demo previews.'; }, 0);
})();
