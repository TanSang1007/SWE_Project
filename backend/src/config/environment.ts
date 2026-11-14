import { initiationSettings } from '../payments/vnpay/initiation-config';
import type { VnpayConfig } from '../payments/vnpay/vnpay-config';
export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  FRONTEND_ORIGIN: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: number;
  PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX';
  VNPAY_INITIATION_CONFIG: VnpayConfig | null;
  VNPAY_ACCEPT_NEW_PAYMENTS?: boolean;
  VNPAY_SANDBOX_ENABLED?: boolean;
}

export function validateEnvironment(values: Record<string, unknown>): Environment {
  const nodeEnv = values.NODE_ENV ?? 'development';
  if (nodeEnv !== 'development' && nodeEnv !== 'test' && nodeEnv !== 'production') {
    throw new Error('NODE_ENV must be development, test or production.');
  }
  const port = Number(values.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  const databaseUrl = requireUrl(values.DATABASE_URL, 'DATABASE_URL', ['postgresql:', 'postgres:']);
  const frontendOrigin = requireUrl(values.FRONTEND_ORIGIN ?? 'http://localhost:3000', 'FRONTEND_ORIGIN', ['http:', 'https:']);
  if (new URL(frontendOrigin).origin !== frontendOrigin) {
    throw new Error('FRONTEND_ORIGIN must contain only scheme, host and port.');
  }
  const secret = values.JWT_SECRET;
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 || secret.startsWith('replace_with_')) {
    throw new Error('JWT_SECRET must be a configured secret of at least 32 bytes.');
  }
  const expiresIn = Number(values.JWT_EXPIRES_IN ?? 3600);
  if (expiresIn !== 3600) throw new Error('JWT_EXPIRES_IN must be 3600 seconds per the approved design.');
  if (values.PAYMENT_MOCK_MODE !== undefined) {
    throw new Error('PAYMENT_MOCK_MODE is no longer supported; use VNPAY_SANDBOX.');
  }
  const providerMode = values.PAYMENT_PROVIDER_MODE ?? 'VNPAY_SANDBOX';
  if (providerMode !== 'VNPAY_SANDBOX') {
    throw new Error('PAYMENT_PROVIDER_MODE must be VNPAY_SANDBOX.');
  }
  const shouldValidateVnpay = nodeEnv === 'test'
    ? values.VNPAY_INITIATION_TEST_ONLY === 'true'
    : (values.VNPAY_SANDBOX_ENABLED !== undefined || values.VNPAY_ENV !== undefined || values.VNPAY_TMN_CODE !== undefined || values.VNPAY_HASH_SECRET !== undefined);
  const vnpaySettings = shouldValidateVnpay
    ? initiationSettings({ ...values, NODE_ENV: nodeEnv, PAYMENT_PROVIDER_MODE: providerMode })
    : { PAYMENT_PROVIDER_MODE: 'VNPAY_SANDBOX' as const, VNPAY_INITIATION_CONFIG: null };
  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    FRONTEND_ORIGIN: frontendOrigin,
    JWT_SECRET: secret,
    JWT_EXPIRES_IN: expiresIn,
    ...vnpaySettings,
  };
}

function requireUrl(value: unknown, name: string, protocols: string[]): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid URL.`); }
  if (!protocols.includes(url.protocol) || !url.hostname) {
    throw new Error(`${name} has an unsupported URL protocol or host.`);
  }
  return value;
}
