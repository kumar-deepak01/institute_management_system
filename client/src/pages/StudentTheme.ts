export type StudentThemeMode = 'light' | 'dark';
export const studentThemeStorageKey = 'student-theme';

export function getInitialStudentTheme(): StudentThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem('app-theme') || window.localStorage.getItem(studentThemeStorageKey);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* Use system appearance if storage is unavailable. */ }
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function applyStudentTheme(
  theme: StudentThemeMode,
  root: { dataset: { studentTheme?: string }; classList?: { add: (c: string) => void; remove: (c: string) => void } },
  storage?: Pick<Storage, 'setItem'>
) {
  root.dataset.studentTheme = theme;
  if (root.classList) {
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }
  try {
    storage?.setItem(studentThemeStorageKey, theme);
    if (typeof window !== 'undefined') window.localStorage?.setItem('app-theme', theme);
  } catch {
    /* Keep this tab usable when storage is blocked. */
  }
}
