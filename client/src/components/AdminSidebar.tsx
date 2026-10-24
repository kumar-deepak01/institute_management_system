import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import AdminIcon from './AdminIcon';
import instituteLogo from '../assets/institute-logo.webp';

type AdminNavItem = { label: string; path: string; icon: string; nested?: boolean };
type AdminNavGroup = { name: string; items: AdminNavItem[] };

const pagePrefetchers: Record<string, () => Promise<unknown>> = {
  '/admin/students': () => import('../pages/AdminStudentsPage'),
  '/admin/staff': () => import('../pages/AdminStaffPage'),
  '/admin/online-admissions': () => import('../pages/AdminAdmissionsPage'),
  '/admin/academic-years': () => import('../pages/AdminCurriculumPage'),
  '/admin/courses': () => import('../pages/AdminCurriculumPage'),
  '/admin/subjects': () => import('../pages/AdminCurriculumPage'),
  '/admin/topics': () => import('../pages/AdminCurriculumPage'),
  '/admin/batches': () => import('../pages/AdminBatchesPage'),
  '/admin/attendance': () => import('../pages/AdminAcademicsPartAPage'),
  '/admin/timetable': () => import('../pages/AdminAcademicsPartAPage'),
  '/admin/leave-holidays': () => import('../pages/AdminAcademicsPartAPage'),
  '/admin/homework': () => import('../pages/AdminAcademicsPartBPage'),
  '/admin/doubts': () => import('../pages/AdminDoubtsPage'),
  '/admin/download-center': () => import('../pages/AdminContentMediaPage'),
  '/admin/video-lectures': () => import('../pages/AdminContentMediaPage'),
  '/admin/live-classes': () => import('../pages/AdminContentMediaPage'),
  '/admin/integrations': () => import('../pages/AdminIntegrationsPage'),
  '/admin/fees': () => import('../pages/AdminFinancePage'),
  '/admin/fee-structures': () => import('../pages/AdminFinancePage'),
  '/admin/discounts': () => import('../pages/AdminFinancePage'),
  '/admin/late-fees': () => import('../pages/AdminFinancePage'),
  '/admin/payment-reminders': () => import('../pages/AdminFinancePage'),
  '/admin/deletion-audit': () => import('../pages/AdminFinancePage'),
  '/admin/accounting-export': () => import('../pages/AdminFinancePage'),
  '/admin/expenses': () => import('../pages/AdminFinancePage'),
  '/admin/expense-heads': () => import('../pages/AdminFinancePage'),
  '/admin/income': () => import('../pages/AdminFinancePage'),
  '/admin/income-heads': () => import('../pages/AdminFinancePage'),
};

const sidebarSnapshot = {
  search: '',
  expanded: {} as Record<string, boolean>,
  scrollTop: 0,
};
let initialActiveItemScrollDone = false;

function AdminSidebar({
  groups,
  currentPath,
  sidebarOpen,
  onClose,
  onNavigate,
  user,
}: {
  groups: AdminNavGroup[];
  currentPath: string;
  sidebarOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
  user?: { name: string; role: string };
}) {
  const navRef = useRef<HTMLElement>(null);
  const [search, setSearch] = useState(sidebarSnapshot.search);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.keys(sidebarSnapshot.expanded).length
      ? sidebarSnapshot.expanded
      : Object.fromEntries(groups.map(group => [group.name, true])),
  );
  const searchRef = useRef(search);
  const expandedRef = useRef(expanded);
  const scrollTopRef = useRef(sidebarSnapshot.scrollTop);
  const visibleGroups = groups
    .map(group => ({ ...group, items: group.items.filter(item => item.label.toLowerCase().includes(search.toLowerCase())) }))
    .filter(group => group.items.length);

  const updateSearch = useCallback((value: string) => {
    searchRef.current = value;
    sidebarSnapshot.search = value;
    setSearch(value);
  }, []);

  const toggleGroup = useCallback((name: string) => {
    setExpanded(current => {
      const next = { ...current, [name]: !current[name] };
      expandedRef.current = next;
      sidebarSnapshot.expanded = next;
      return next;
    });
  }, []);

  const saveScroll = useCallback(() => {
    if (navRef.current) {
      scrollTopRef.current = navRef.current.scrollTop;
      sidebarSnapshot.scrollTop = navRef.current.scrollTop;
    }
  }, []);

  const prefetchPage = useCallback((path: string) => {
    void pagePrefetchers[path]?.();
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    nav.scrollTop = scrollTopRef.current;
    if (!initialActiveItemScrollDone) {
      const activeItem = groups.flatMap(group => group.items).find(item =>
        item.path === currentPath || (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`)),
      );
      const active = activeItem ? nav.querySelector<HTMLElement>(`[data-nav-path="${activeItem.path}"]`) : null;
      if (active) {
        const navRect = nav.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        if (activeRect.top < navRect.top || activeRect.bottom > navRect.bottom) {
          active.scrollIntoView({ block: 'nearest' });
        }
      }
      initialActiveItemScrollDone = true;
    }
  }, []);

  const userName = user?.name || 'Deepak';
  const userInitials = userName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0].toUpperCase())
    .join('') || 'DF';

  return (
    <aside
      className={`${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      } fixed inset-y-0 left-0 z-40 flex w-[335px] flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:translate-x-0`}
    >
      {/* Sidebar Header with Optimized Logo */}
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5 dark:border-slate-800">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-white">
          <img
            src={instituteLogo}
            alt="My JEE Mentor"
            className="h-8 w-8 object-contain"
            width="32"
            height="32"
          />
        </div>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px] font-black text-slate-800 dark:text-white">My JEE Mentor</b>
          <span className="block truncate text-xs font-semibold text-orange-600 dark:text-orange-400">
            Institute Admin
          </span>
        </div>
        <button
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 lg:hidden"
          aria-label="Close navigation"
        >
          <AdminIcon name="close" className="h-5 w-5" />
        </button>
      </div>

      {/* Menu Search */}
      <div className="px-4 pt-4 pb-2">
        <label className="relative block">
          <span className="absolute left-3.5 top-2.5 text-slate-400">
            <AdminIcon name="search" className="h-4 w-4" />
          </span>
          <input
            value={search}
            onChange={event => updateSearch(event.target.value)}
            placeholder="Search menu..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-orange-500 focus:bg-white dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-orange-500 dark:focus:bg-slate-800"
          />
        </label>
      </div>

      {/* Menu Navigation Items */}
      <nav ref={navRef} onScroll={saveScroll} className="admin-scrollbar flex-1 overflow-y-auto px-4 py-2" aria-label="Admin menu">
        {visibleGroups.map(group => (
          <section key={group.name} className="mb-4">
            <button
              className="flex h-8 w-full items-center justify-between px-2 text-left text-[11px] font-black uppercase tracking-[.14em] text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              onClick={() => toggleGroup(group.name)}
              aria-expanded={expanded[group.name]}
            >
              {group.name}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                  expanded[group.name] ? '' : '-rotate-90'
                }`}
              >
                <path
                  d="m5 7.5 5 5 5-5"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
            {(expanded[group.name] || search.trim().length > 0) && (
              <div className="mt-1 grid gap-0.5">
                {group.items.map(item => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/admin'}
                    data-nav-path={item.path}
                    onClick={onNavigate}
                    onMouseEnter={() => prefetchPage(item.path)}
                    onFocus={() => prefetchPage(item.path)}
                    aria-current={
                      currentPath === item.path ||
                      (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`))
                        ? 'page'
                        : undefined
                    }
                    className={({ isActive }) => {
                      const selected =
                        isActive ||
                        currentPath === item.path ||
                        (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`));
                      const selectedDashboard = selected && item.path === '/admin';
                      return `flex h-[44px] w-full items-center rounded-xl text-left text-[14px] tracking-[-.01em] transition-all duration-150 ${
                        item.nested ? 'gap-2.5 pl-[32px] pr-3 font-medium' : 'gap-3 px-3 font-semibold'
                      } ${
                        selectedDashboard
                          ? 'bg-orange-500 text-white shadow-md shadow-orange-500/25 font-bold'
                          : selected
                            ? 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400 font-bold'
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white'
                      }`;
                    }}
                  >
                    {({ isActive }) => {
                      const selected =
                        isActive ||
                        currentPath === item.path ||
                        (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`));
                      const selectedDashboard = selected && item.path === '/admin';
                      return (
                        <>
                          <AdminIcon
                            name={item.icon}
                            className={`${item.nested ? 'h-[18px] w-[18px]' : 'h-[20px] w-[20px]'} shrink-0 ${
                              selectedDashboard
                                ? 'text-white'
                                : selected
                                  ? 'text-orange-600 dark:text-orange-400'
                                  : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </>
                      );
                    }}
                  </NavLink>
                ))}
              </div>
            )}
          </section>
        ))}
      </nav>

      {/* User Card at Bottom matching Screenshot 1 */}
      <div className="border-t border-slate-100 p-4 dark:border-slate-800">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-2.5 transition dark:border-slate-800 dark:bg-slate-800/60">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-tr from-orange-500 to-amber-500 text-sm font-black text-white shadow-sm shadow-orange-500/20">
            {userInitials}
          </span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-sm font-bold text-slate-800 dark:text-white">{userName}</b>
            <span className="block truncate text-xs font-semibold text-slate-400 dark:text-slate-500">
              Institute Admin
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default memo(AdminSidebar);
