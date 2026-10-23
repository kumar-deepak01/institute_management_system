export type TeacherThemeMode = 'light' | 'dark';
export const teacherThemeStorageKey = 'teacher-theme';

export function getInitialTeacherTheme(): TeacherThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(teacherThemeStorageKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* Storage may be blocked; use the system preference. */ }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTeacherTheme(theme: TeacherThemeMode, root: { dataset: { teacherTheme?: string } }, storage?: Pick<Storage, 'setItem'>) {
  root.dataset.teacherTheme = theme;
  try { storage?.setItem(teacherThemeStorageKey, theme); }
  catch { /* Keep the current session usable if storage is blocked. */ }
}
