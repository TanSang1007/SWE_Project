'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthNav } from './auth-nav';

export function SiteFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <SiteFrameContent pathname={pathname}>{children}</SiteFrameContent>;
}
export function SiteFrameContent({ children, pathname }: { children: ReactNode; pathname: string }) {
  const operations = /^\/(operator|admin)(?:\/|$)/.test(pathname);
  if (operations) return <main id="main-content" className="operations-root">{children}</main>;
  return <><header className="site-header"><div className="header-inner"><Link href="/" className="brand" aria-label="BrewLite — về thực đơn"><span className="brand-mark" aria-hidden="true">b.</span>BrewLite</Link><AuthNav /></div></header>
    <main id="main-content" className="page-shell">{children}</main><footer className="site-footer"><span>BrewLite</span><p>Một ly ngon. Một khoảng nghỉ nhẹ nhàng.</p></footer></>;
}
