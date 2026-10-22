import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFrame } from '../components/site-frame';
import { AuthSession } from '../components/auth-session';
import './globals.css';

export const metadata: Metadata = { title: 'BrewLite — Thực đơn', description: 'Khám phá đồ uống, kích cỡ và topping trong thực đơn BrewLite.' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="vi"><body><a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <AuthSession><SiteFrame>{children}</SiteFrame></AuthSession></body></html>;
}
