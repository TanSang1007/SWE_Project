'use client';
import { useEffect, useState } from 'react';
export function PaymentCountdown({ expiresAt, serverNow, verifying = false }: { expiresAt?: string | null; serverNow?: string; verifying?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const timer = setInterval(() => setElapsed(performance.now() - start), 1000);
    return () => clearInterval(timer);
  }, [expiresAt, serverNow]);
  if (!expiresAt || !serverNow) return null;
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(serverNow) - elapsed) / 1000));
  return seconds > 0 ? <p>Thời gian thanh toán còn lại: <time dateTime={expiresAt}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time></p>
    : <p role="status">{verifying ? 'Hết thời gian thanh toán — đang xác minh kết quả' : 'Đã hết thời gian hiệu lực thanh toán'}</p>;
}
