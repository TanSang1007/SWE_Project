import type { ReactNode } from 'react';
import { OperatorShell } from '../../components/operator-shell';
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <OperatorShell allowed={['ADMIN']}>{children}</OperatorShell>;
}
