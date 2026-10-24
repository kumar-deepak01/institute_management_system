import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest, ApiRequestError } from '../services/api';
import { currentAccount, login } from '../services/auth';
import { clearCurrentAccountCache } from '../services/authCache';
import type { Account } from '../types/api';
// @ts-expect-error - LampLogin is an untyped JSX presentation component
import LampLogin from './LampLogin';

type Mode = 'login' | 'forgot' | 'reset';
const roleRoute = (role: Account['role']) => role === 'admin' ? '/admin' : role === 'teacher' ? '/teacher' : '/student';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    currentAccount().then(({ account }) => {
      if (active) navigate(account.mustChangePassword ? '/change-password' : roleRoute(account.role), { replace: true });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [navigate]);

  async function handleLoginSubmit({ email: loginEmail, password: loginPassword }: { email: string; password: string; remember?: boolean }) {
    try {
      const result = await login(loginEmail, loginPassword);
      setTimeout(() => {
        navigate(result.account.mustChangePassword ? '/change-password' : roleRoute(result.account.role), { replace: true });
      }, 300);
      return { ok: true, message: 'Login successful. Redirecting to My Classroom...' };
    } catch (cause) {
      if (cause instanceof ApiRequestError && [400, 401, 403, 422].includes(cause.status)) {
        return { ok: false, message: 'Invalid ID or password. Please check your details and try again.' };
      }
      throw cause;
    }
  }

  async function requestReset(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setNotice(`${result.message} If registered, the code is valid for 10 minutes.`);
      setMode('reset');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password reset could not be requested.');
    } finally {
      setBusy(false);
    }
  }

  async function resendReset() {
    setError('');
    setBusy(true);
    try {
      const result = await apiRequest<{ message: string }>('/api/auth/forgot-password', { method: 'POST', body: { email } });
      setNotice(`${result.message} If registered, the code is valid for 10 minutes.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Password reset could not be requested.');
    } finally {
      setBusy(false);
    }
  }

  async function finishReset(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await apiRequest('/api/auth/reset-password', { method: 'POST', body: { email, otp, newPassword: password, confirmPassword: confirm } });
      clearCurrentAccountCache();
      setPassword('');
      setConfirm('');
      setOtp('');
      setMode('login');
      setNotice('Password updated. Sign in with your new password.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset the password.');
    } finally {
      setBusy(false);
    }
  }

  const modalInput = 'mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none placeholder:text-zinc-500 focus:border-[#8b7cf6] focus:ring-2 focus:ring-[#8b7cf6]/20 text-sm';

  return (
    <div className="relative">
      <LampLogin
        onSubmit={handleLoginSubmit}
        onForgotPassword={() => { setMode('forgot'); setError(''); setNotice(''); }}
        admissionUrl="/admissions"
      />

      {mode !== 'login' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-modal-title"
          onClick={(e) => { if (e.target === e.currentTarget) setMode('login'); }}
        >
          <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-[#16161c] p-7 shadow-2xl text-slate-100 sm:p-8">
            <button
              type="button"
              onClick={() => setMode('login')}
              className="absolute right-5 top-5 text-zinc-400 hover:text-white"
              aria-label="Close dialog"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <p className="text-[11px] font-bold tracking-[.25em] text-[#8b7cf6] uppercase">MY JEE MENTOR ACCOUNT</p>
            <h2 id="reset-modal-title" className="mt-2 text-2xl font-bold font-serif text-zinc-100">
              {mode === 'forgot' ? 'Reset your password' : 'Enter reset code'}
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              {mode === 'forgot' ? 'Enter your account email to receive a verification code.' : 'Password reset codes expire after 10 minutes.'}
            </p>

            {notice && <p role="status" className="mt-4 rounded-xl bg-indigo-950/60 border border-indigo-500/30 p-3 text-xs text-indigo-300">{notice}</p>}
            {error && <p role="alert" className="mt-4 rounded-xl bg-rose-950/60 border border-rose-500/30 p-3 text-xs text-rose-300">{error}</p>}

            {mode === 'forgot' && (
              <form className="mt-5 grid gap-4" onSubmit={requestReset}>
                <label className="text-xs font-semibold text-zinc-300">
                  Account email
                  <input
                    className={modalInput}
                    type="email"
                    required
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 rounded-xl bg-gradient-to-r from-[#9a85f7] to-[#6d4fd8] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[#6d4fd8]/25 hover:brightness-110 disabled:opacity-50 transition"
                >
                  {busy ? 'Sending code…' : 'Send verification code'}
                </button>
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-xs text-zinc-400 hover:text-zinc-200 text-center"
                >
                  Back to login
                </button>
              </form>
            )}

            {mode === 'reset' && (
              <form className="mt-5 grid gap-3" onSubmit={finishReset}>
                <label className="text-xs font-semibold text-zinc-300">
                  6-digit code
                  <input
                    className={`${modalInput} tracking-[.35em] text-center font-mono text-base`}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="one-time-code"
                    required
                    placeholder="123456"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </label>
                <label className="text-xs font-semibold text-zinc-300">
                  New password
                  <input
                    className={modalInput}
                    type="password"
                    minLength={10}
                    autoComplete="new-password"
                    required
                    placeholder="At least 10 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <label className="text-xs font-semibold text-zinc-300">
                  Confirm password
                  <input
                    className={modalInput}
                    type="password"
                    minLength={10}
                    autoComplete="new-password"
                    required
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="mt-2 rounded-xl bg-gradient-to-r from-[#9a85f7] to-[#6d4fd8] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[#6d4fd8]/25 hover:brightness-110 disabled:opacity-50 transition"
                >
                  {busy ? 'Saving…' : 'Reset password'}
                </button>
                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resendReset()}
                    className="text-[#8b7cf6] hover:underline"
                  >
                    Resend code
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('forgot')}
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    Change email
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}