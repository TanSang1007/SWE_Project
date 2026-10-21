export const SANDBOX_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';

export function requireVnpay(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid VNPAY input or configuration');
}

export interface VnpayConfig {
  readonly environment: 'SANDBOX';
  readonly version: '2.1.0';
  readonly merchantCode: string;
  readonly hashSecret: string;
  readonly paymentUrl: string;
  readonly returnUrl: string;
  readonly ipnUrl: string;
}

// Explicit opt-in parser; never reads process.env or changes the active provider.
export function parseVnpayConfig(env: Readonly<Record<string, string | undefined>>): VnpayConfig {
  requireVnpay(env.VNPAY_ENV === 'SANDBOX' && env.VNPAY_VERSION === '2.1.0');
  const merchantCode = env.VNPAY_TMN_CODE ?? '';
  const hashSecret = env.VNPAY_HASH_SECRET ?? '';
  requireVnpay(/^[A-Za-z0-9]{8}$/.test(merchantCode));
  requireVnpay(hashSecret.trim().length > 0 && hashSecret.length <= 1024 &&
    !/\p{Cc}/u.test(hashSecret) && !/placeholder|replace|example|your[_-]/i.test(hashSecret));
  requireVnpay(env.VNPAY_PAYMENT_URL === SANDBOX_PAYMENT_URL);
  const callback = (value: string | undefined, path: string) => {
    requireVnpay(value && value.length <= 255);
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Invalid VNPAY callback configuration'); }
    requireVnpay(url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === path && !url.port &&
      /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(url.hostname) &&
      !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname) &&
      !/^\d+(?:\.\d+){3}$/.test(url.hostname));
    return url;
  };
  const returnUrl = callback(env.VNPAY_RETURN_URL, '/payments/vnpay/return');
  const ipnUrl = callback(env.VNPAY_IPN_URL, '/payments/vnpay/ipn');
  requireVnpay(returnUrl.origin === ipnUrl.origin);
  return Object.freeze({ environment: 'SANDBOX', version: '2.1.0', merchantCode,
    hashSecret, paymentUrl: SANDBOX_PAYMENT_URL, returnUrl: returnUrl.href, ipnUrl: ipnUrl.href });
}

// Revalidate even at the public helper boundary: TypeScript types are not runtime guards.
export function validateVnpayConfig(config: VnpayConfig): VnpayConfig {
  return parseVnpayConfig({ VNPAY_ENV: config.environment, VNPAY_VERSION: config.version,
    VNPAY_TMN_CODE: config.merchantCode, VNPAY_HASH_SECRET: config.hashSecret,
    VNPAY_PAYMENT_URL: config.paymentUrl, VNPAY_RETURN_URL: config.returnUrl, VNPAY_IPN_URL: config.ipnUrl });
}
