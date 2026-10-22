import type { Credentials, LoginResponse, PublicUser } from '../../types/auth';
export class AuthError extends Error {
  constructor(public readonly code: 'VALIDATION_ERROR' | 'EMAIL_ALREADY_EXISTS' | 'INVALID_CREDENTIALS' | 'UNAVAILABLE') { super(code); }
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AuthError('UNAVAILABLE');
  return value as Record<string, unknown>;
}
function publicUser(value: unknown): PublicUser {
  const data = object(value);
  if (typeof data.id !== 'string' || typeof data.email !== 'string' || typeof data.loyaltyPoints !== 'number' || !Number.isInteger(data.loyaltyPoints) || data.loyaltyPoints < 0
    || typeof data.role !== 'string' || !['CUSTOMER', 'STAFF', 'ADMIN'].includes(data.role)) throw new AuthError('UNAVAILABLE');
  return { id: data.id, email: data.email, loyaltyPoints: data.loyaltyPoints, role: data.role as PublicUser['role'] };
}
export function parseLogin(value: unknown): LoginResponse {
  const data = object(value);
  if (typeof data.accessToken !== 'string' || !data.accessToken || data.tokenType !== 'Bearer' || data.expiresIn !== 3600) throw new AuthError('UNAVAILABLE');
  return { accessToken: data.accessToken, tokenType: 'Bearer', expiresIn: 3600, user: publicUser(data.user) };
}
async function post(path: string, credentials: Credentials, signal?: AbortSignal): Promise<unknown> {
  try {
    const timeout = AbortSignal.timeout(5000);
    const response = await fetch(`/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BrewLite-CSRF': '1' }, credentials: 'same-origin', cache: 'no-store', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: JSON.stringify({ email: credentials.email.trim().toLowerCase(), password: credentials.password }),
    });
    if (!response.ok) {
      if (response.status === 400) throw new AuthError('VALIDATION_ERROR');
      if (response.status === 409) throw new AuthError('EMAIL_ALREADY_EXISTS');
      if (response.status === 401) throw new AuthError('INVALID_CREDENTIALS');
      throw new AuthError('UNAVAILABLE');
    }
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof AuthError || (error instanceof Error && error.name === 'AbortError')) throw error;
    throw new AuthError('UNAVAILABLE');
  }
}
export async function register(credentials: Credentials, signal?: AbortSignal): Promise<{ user: PublicUser }> {
  return { user: publicUser(object(await post('register', credentials, signal)).user) };
}
export async function login(credentials: Credentials, signal?: AbortSignal): Promise<LoginResponse> {
  const work = async () => parseLogin(await post('login', credentials, signal));
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('brewlite-session', work) : work();
}
export function authErrorMessage(code: AuthError['code']): string {
  return {
    VALIDATION_ERROR: 'Thông tin chưa hợp lệ. Kiểm tra email và độ dài mật khẩu.',
    EMAIL_ALREADY_EXISTS: 'Email này đã được đăng ký. Bạn có thể đăng nhập.',
    INVALID_CREDENTIALS: 'Email hoặc mật khẩu chưa đúng.',
    UNAVAILABLE: 'Chưa kết nối được. Vui lòng thử lại sau.',
  }[code];
}
