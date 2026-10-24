import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

export function getInitialTheme(role?: 'admin' | 'teacher' | 'student'): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const roleKey = role === 'teacher' ? 'teacher-theme' : role === 'student' ? 'student-theme' : 'admin-theme';
    const saved = window.localStorage.getItem('app-theme') || window.localStorage.getItem(roleKey);
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyThemeClass(theme: ThemeMode, role?: 'admin' | 'teacher' | 'student') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  root.dataset.theme = theme;
  if (role === 'teacher') root.dataset.teacherTheme = theme;
  if (role === 'student') root.dataset.studentTheme = theme;

  try {
    window.localStorage.setItem('app-theme', theme);
    if (role) {
      const roleKey = role === 'teacher' ? 'teacher-theme' : role === 'student' ? 'student-theme' : 'admin-theme';
      window.localStorage.setItem(roleKey, theme);
    }
  } catch {
    /* Ignore storage errors */
  }
}

export function useAppTheme(role: 'admin' | 'teacher' | 'student' = 'admin') {
  const [theme, setThemeState] = useState<ThemeMode>(() => getInitialTheme(role));

  useEffect(() => {
    applyThemeClass(theme, role);
  }, [theme, role]);

  const toggleTheme = useCallback(() => {
    setThemeState(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
  }, []);

  return { theme, toggleTheme, setTheme, isDark: theme === 'dark' };
}
