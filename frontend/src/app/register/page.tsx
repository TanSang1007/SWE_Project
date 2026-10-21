import { Suspense } from 'react';
import { AuthForm } from '../../components/auth-form';
export default function RegisterPage() { return <Suspense fallback={<p role="status">Đang tải…</p>}><AuthForm mode="register" /></Suspense>; }
