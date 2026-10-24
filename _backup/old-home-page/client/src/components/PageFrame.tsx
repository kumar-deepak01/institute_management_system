import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function PageFrame({ children }: { children: ReactNode }) { return <div className="min-h-screen bg-white text-slate-900"><SiteHeader />{children}<SiteFooter /></div>; }
