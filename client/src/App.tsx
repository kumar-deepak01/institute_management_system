import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import PasswordChangeGate from './components/PasswordChangeGate';
import PublicLayout from './components/PublicLayout';
import LoginPage from './pages/LoginPage';

const FeaturesPage = lazy(() => import('./pages/FeaturesPage'));
const AdmissionPage = lazy(() => import('./pages/AdmissionPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const StudentPage = lazy(() => import('./pages/StudentPage'));
const TeacherPage = lazy(() => import('./pages/TeacherPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));

const prefetchers: Record<string, () => Promise<unknown>> = {
  '/features': () => import('./pages/FeaturesPage'),
  '/features.html': () => import('./pages/FeaturesPage'),
  '/change-password': () => import('./pages/ChangePasswordPage'),
  '/admin': () => import('./pages/AdminPage'),
  '/admin.html': () => import('./pages/AdminPage'),
  '/teacher': () => import('./pages/TeacherPage'),
  '/teacher.html': () => import('./pages/TeacherPage'),
  '/student': () => import('./pages/StudentPage'),
  '/student.html': () => import('./pages/StudentPage'),
  '/form.html': () => import('./pages/AdmissionPage'),
  '/admissions': () => import('./pages/AdmissionPage'),
};

function RouteLoading() {
  return <div role="status" className="grid min-h-screen place-items-center text-sm text-slate-500">Loading page…</div>;
}

function RouteEffects() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname.replace(/\/$/, '') || '/';
    const title = path === '/' || path === '/index.html' || path === '/login' || path === '/login.html' ? 'Log in | My JEE Mentor'
      : path === '/admin.html' || path === '/admin' ? 'Dashboard | My JEE Mentor'
      : path.startsWith('/admin/') ? `${path.split('/').filter(Boolean)[1]?.replace(/-/g, ' ') || 'Dashboard'} | My JEE Mentor`
      : path.startsWith('/teacher') ? 'Teacher Workspace | My JEE Mentor'
      : path.startsWith('/student') ? 'Student Workspace | My JEE Mentor'
      : path.includes('login') || path.includes('portal') ? 'Log in | My JEE Mentor'
      : path.includes('password') ? 'Change Password | My JEE Mentor'
      : path.includes('admission') || path === '/form.html' ? 'Admissions | My JEE Mentor'
      : path.includes('features') ? 'Features | My JEE Mentor' : 'My JEE Mentor';
    document.title = title;

    let observer: MutationObserver | null = null;
    const frame = window.requestAnimationFrame(() => {
      if (location.hash) {
        const targetId = decodeURIComponent(location.hash.slice(1));
        const scrollToTarget = () => {
          const target = document.getElementById(targetId);
          if (!target) return false;
          target.scrollIntoView({ block: 'start' });
          observer?.disconnect();
          return true;
        };
        if (!scrollToTarget()) {
          observer = new MutationObserver(() => { scrollToTarget(); });
          observer.observe(document.getElementById('root') || document.body, { childList: true, subtree: true });
        }
      } else {
        window.scrollTo({ top: 0, left: 0 });
      }
    });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const prefetch = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, document.baseURI);
      if (url.origin !== new URL(document.baseURI).origin) return;
      void prefetchers[url.pathname]?.();
    };
    document.addEventListener('pointerover', prefetch);
    document.addEventListener('focusin', prefetch);
    return () => {
      document.removeEventListener('pointerover', prefetch);
      document.removeEventListener('focusin', prefetch);
    };
  }, []);

  return null;
}

function Protected({ children }: { children: ReactNode }) {
  return <PasswordChangeGate><Suspense fallback={<RouteLoading />}>{children}</Suspense></PasswordChangeGate>;
}

export default function App() {
  return <HelmetProvider>
    <RouteEffects />
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LoginPage />} />
        <Route path="/index.html" element={<LoginPage />} />
        <Route path="/features" element={<Suspense fallback={<RouteLoading />}><FeaturesPage /></Suspense>} />
        <Route path="/features.html" element={<Suspense fallback={<RouteLoading />}><FeaturesPage /></Suspense>} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login.html" element={<LoginPage />} />
      <Route path="/portal" element={<LoginPage />} />
      <Route path="/portal.html" element={<LoginPage />} />
      <Route path="/change-password" element={<Suspense fallback={<RouteLoading />}><ChangePasswordPage /></Suspense>} />
      <Route path="/admin/*" element={<Protected><AdminPage /></Protected>} />
      <Route path="/admin.html" element={<Protected><AdminPage /></Protected>} />
      <Route path="/teacher/*" element={<Protected><TeacherPage /></Protected>} />
      <Route path="/teacher.html" element={<Protected><TeacherPage /></Protected>} />
      <Route path="/student/*" element={<Protected><StudentPage /></Protected>} />
      <Route path="/student.html" element={<Protected><StudentPage /></Protected>} />
      <Route path="/form.html" element={<Suspense fallback={<RouteLoading />}><AdmissionPage /></Suspense>} />
      <Route path="/admissions" element={<Suspense fallback={<RouteLoading />}><AdmissionPage /></Suspense>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </HelmetProvider>;
}
