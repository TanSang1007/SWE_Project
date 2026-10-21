import type { Credentials } from '../types/auth';
export function validateCredentials({ email, password }: Credentials): string | null {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return 'Vui lòng nhập email hợp lệ (tối đa 254 ký tự).';
  const bytes = new TextEncoder().encode(password).length;
  if (bytes < 8 || bytes > 72) return 'Mật khẩu cần từ 8 đến 72 byte UTF-8; dấu cách không bị cắt bỏ.';
  return null;
}
export function safeReturnTo(value: string | null): string {
  if (value?.startsWith('/payments')) return /^\/payments\/vnpay\/result\?attemptId=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : '/';
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /^\/(login|register)(\/|\?|$)/.test(value)) return '/';
  return value;
}
