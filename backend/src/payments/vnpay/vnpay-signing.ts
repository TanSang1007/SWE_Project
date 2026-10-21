import { createHmac, timingSafeEqual } from 'node:crypto';
import { requireVnpay } from './vnpay-config';

export type VnpayParameters = Readonly<Record<string, string>>;
const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, '+');

// PAY 2.1.0 Node reference encoding. Do not replace with URLSearchParams.
export function canonicalize(parameters: VnpayParameters): string {
  return Object.keys(parameters).sort().map(key => {
    const value = parameters[key];
    requireVnpay(/^vnp_[A-Za-z0-9]+$/.test(key) && typeof value === 'string' &&
      !/\p{Cc}/u.test(value));
    return `${encode(key)}=${encode(value)}`;
  }).join('&');
}

export function signParameters(parameters: VnpayParameters, secret: string): string {
  requireVnpay(typeof secret === 'string' && secret.length > 0);
  requireVnpay(!Object.hasOwn(parameters, 'vnp_SecureHash') && !Object.hasOwn(parameters, 'vnp_SecureHashType'));
  return createHmac('sha512', secret).update(canonicalize(parameters), 'utf8').digest('hex');
}

export function verifySignature(parameters: VnpayParameters, signature: string, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const actual = Buffer.from(signature, 'hex');
  const expected = Buffer.from(signParameters(parameters, secret), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Accept the raw query, never a framework-coerced object that has lost duplicates.
export function parseRawQuery(raw: string): Record<string, string> {
  requireVnpay(typeof raw === 'string' && raw.length > 0 && Buffer.byteLength(raw, 'utf8') <= 8192);
  const pairs = raw.split('&');
  requireVnpay(pairs.length <= 30);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const pair of pairs) {
    const separator = pair.indexOf('=');
    requireVnpay(separator > 0);
    let key: string, value: string;
    try {
      key = decodeURIComponent(pair.slice(0, separator).replace(/\+/g, ' '));
      value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, ' '));
    } catch { throw new Error('Malformed VNPAY query encoding'); }
    requireVnpay(/^vnp_[A-Za-z0-9]+$/.test(key) && !Object.hasOwn(result, key) &&
      value.length > 0 && !/\p{Cc}/u.test(value));
    result[key] = value;
  }
  return result;
}
