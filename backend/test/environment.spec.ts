import { validateEnvironment } from '../src/config/environment';
import { randomBytes } from 'node:crypto';

const valid = { DATABASE_URL: 'postgresql://demo:example@localhost:5432/brewlite', FRONTEND_ORIGIN: 'http://localhost:3000', JWT_SECRET: randomBytes(32).toString('hex') };
describe('Environment configuration', () => {
  it('defaults payment provider mode to VNPAY_SANDBOX and rejects Mock payment flags', () => {
    expect(validateEnvironment(valid).PAYMENT_PROVIDER_MODE).toBe('VNPAY_SANDBOX');
    expect(validateEnvironment({ ...valid, PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX' }).PAYMENT_PROVIDER_MODE).toBe('VNPAY_SANDBOX');
    for (const PAYMENT_PROVIDER_MODE of ['MOCK', 'OTHER', '']) {
      expect(() => validateEnvironment({ ...valid, PAYMENT_PROVIDER_MODE })).toThrow('PAYMENT_PROVIDER_MODE');
    }
    for (const PAYMENT_MOCK_MODE of ['SUCCESS', 'FAILURE', 'RANDOM', '']) {
      expect(() => validateEnvironment({ ...valid, PAYMENT_MOCK_MODE })).toThrow('PAYMENT_MOCK_MODE');
    }
  });
  it('normalizes the port and development default', () => {
    expect(validateEnvironment({ ...valid, PORT: '3001' })).toMatchObject({ PORT: 3001, NODE_ENV: 'development' });
  });
  it.each(['0', '65536', 'invalid', '3.5'])('rejects invalid PORT %s', (PORT) => {
    expect(() => validateEnvironment({ ...valid, PORT })).toThrow('PORT');
  });
  it('rejects missing database URL or unsupported protocol', () => {
    expect(() => validateEnvironment({})).toThrow('DATABASE_URL');
    expect(() => validateEnvironment({ ...valid, DATABASE_URL: 'https://localhost' })).toThrow('DATABASE_URL');
  });
  it('rejects origin paths and invalid runtime modes', () => {
    expect(() => validateEnvironment({ ...valid, FRONTEND_ORIGIN: 'http://localhost:3000/path' })).toThrow('FRONTEND_ORIGIN');
    expect(() => validateEnvironment({ ...valid, NODE_ENV: 'other' })).toThrow('NODE_ENV');
  });
  it('rejects missing/weak/sample secrets and TTL changes without printing values', () => {
    for (const JWT_SECRET of [undefined, 'short', 'replace_with_a_random_secret_at_least_32_bytes']) {
      expect(() => validateEnvironment({ ...valid, JWT_SECRET })).toThrow('JWT_SECRET');
    }
    expect(() => validateEnvironment({ ...valid, JWT_EXPIRES_IN: '7200' })).toThrow('JWT_EXPIRES_IN');
    expect(validateEnvironment(valid).JWT_EXPIRES_IN).toBe(3600);
  });
});
