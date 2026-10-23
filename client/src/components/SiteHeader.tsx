import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import logo from '../assets/mainlogo.png'; import AdminIcon from './AdminIcon';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const nav = [['Features', '/features']];
  return <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4"><Link to="/login" className="flex items-center gap-3 font-extrabold tracking-tight text-slate-900"><img src={logo} alt="" className="h-10 w-10 rounded-xl object-contain"/><span>My JEE Mentor</span></Link><button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg border px-3 py-2 text-slate-700 md:hidden"><AdminIcon name="menu" className="h-5 w-5"/></button><nav className={`${open ? 'flex' : 'hidden'} absolute left-0 right-0 top-full flex-col gap-1 border-b bg-white p-4 md:static md:flex md:flex-row md:items-center md:gap-7 md:border-0 md:bg-transparent md:p-0`}>{nav.map(([label, to]) => <NavLink key={label} to={to} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-700">{label}</NavLink>)}<Link to="/login" className="mt-2 rounded-xl border border-slate-200 px-4 py-2 text-center text-sm font-bold text-slate-700 md:mt-0">Log in</Link><Link to="/admissions" className="rounded-xl bg-indigo-600 px-4 py-2 text-center text-sm font-bold text-white shadow-md shadow-indigo-200">Apply now ↗</Link></nav></div></header>;
}
