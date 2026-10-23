import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import AdminIcon from './AdminIcon';

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

let sidebarSnapshot = {
  search: '',
  expanded: {} as Record<string, boolean>,
  scrollTop: 0,
};
let initialActiveItemScrollDone = false;

function AdminSidebar({ groups, currentPath, sidebarOpen, onClose, onNavigate }: {
  groups: AdminNavGroup[];
  currentPath: string;
  sidebarOpen: boolean;
  onClose: () => void;
  onNavigate: () => void;
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

  return <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 flex w-[335px] flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0`}>
    <div className="flex h-[72px] items-center gap-3 border-b border-slate-100 px-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 font-black text-white">MJ</span><div><b className="block text-[15px]">My JEE Mentor</b><span className="text-xs text-slate-500">Institute admin</span></div><button onClick={onClose} className="ml-auto text-xl text-slate-400 lg:hidden" aria-label="Close navigation"><AdminIcon name="close" className="h-5 w-5"/></button></div>
    <div className="px-4 pt-5"><label className="relative block"><span className="absolute left-3 top-2.5 text-slate-400"><AdminIcon name="search" className="h-4 w-4"/></span><input value={search} onChange={event => updateSearch(event.target.value)} placeholder="Search menu" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></label></div>
    <nav ref={navRef} onScroll={saveScroll} className="admin-scrollbar flex-1 overflow-y-auto px-6 py-3" aria-label="Admin menu">
      {visibleGroups.map(group => <section key={group.name} className="mb-5">
        <button className="flex h-9 w-full items-center justify-between text-left text-[12px] font-extrabold uppercase tracking-[.12em] text-[#1d2a3f]" onClick={() => toggleGroup(group.name)} aria-expanded={expanded[group.name]}>
          {group.name}
          <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-4 w-4 text-slate-400 transition-transform ${expanded[group.name] ? '' : '-rotate-90'}`}><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
        </button>
        {(expanded[group.name] || search.trim().length > 0) && <div className="grid gap-0.5">{group.items.map(item => <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/admin'}
          data-nav-path={item.path}
          onClick={onNavigate}
          onMouseEnter={() => prefetchPage(item.path)}
          onFocus={() => prefetchPage(item.path)}
          aria-current={currentPath === item.path || (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`)) ? 'page' : undefined}
          className={({ isActive }) => {
            const selected = isActive || currentPath === item.path || (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`));
            const selectedDashboard = selected && item.path === '/admin';
            return `flex h-[50px] w-full items-center rounded-[14px] text-left text-[16px] tracking-[-.015em] transition-colors ${item.nested ? 'gap-3 pl-[35px] pr-3 font-medium' : 'gap-[11px] px-3 font-semibold'} ${selectedDashboard ? 'bg-[#2864ed] text-white shadow-[0_2px_4px_rgba(30,64,175,0.25)]' : selected ? 'bg-[#edf3ff] text-[#2864ed]' : 'text-[#1b2a41] hover:bg-[#edf3ff] hover:text-[#2864ed]'}`;
          }}
        >{({ isActive }) => {
          const selected = isActive || currentPath === item.path || (item.path !== '/admin' && currentPath.startsWith(`${item.path}/`));
          const selectedDashboard = selected && item.path === '/admin';
          return <><AdminIcon name={item.icon} className={`${item.nested ? 'h-[19px] w-[19px]' : 'h-[24px] w-[24px]'} shrink-0 ${selectedDashboard ? 'text-white' : 'text-[#315ed1]'}`} /><span>{item.label}</span></>;
        }}</NavLink>)}</div>}
      </section>)}
    </nav>
    <div className="border-t border-slate-100 p-4"><div className="rounded-xl bg-indigo-50 p-3"><p className="text-xs font-bold text-indigo-900">My JEE Mentor</p><p className="mt-1 text-[11px] leading-4 text-indigo-700">Your institute workspace</p></div></div>
  </aside>;
}

export default memo(AdminSidebar);
