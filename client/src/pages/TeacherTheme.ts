export type TeacherThemeMode = 'light' | 'dark';
export const teacherThemeStorageKey = 'teacher-theme';

export function getInitialTeacherTheme(): TeacherThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem('app-theme') || window.localStorage.getItem(teacherThemeStorageKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* Storage may be blocked; use the system preference. */ }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyTeacherTheme(
  theme: TeacherThemeMode,
  root: { dataset: { teacherTheme?: string }; classList?: { add: (c: string) => void; remove: (c: string) => void } },
  storage?: Pick<Storage, 'setItem'>
) {
  root.dataset.teacherTheme = theme;
  if (root.classList) {
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }
  try {
    storage?.setItem(teacherThemeStorageKey, theme);
    if (typeof window !== 'undefined') window.localStorage?.setItem('app-theme', theme);
  } catch {
    /* Keep the current session usable if storage is blocked. */
  }
}
