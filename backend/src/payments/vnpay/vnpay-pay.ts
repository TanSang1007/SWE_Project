import { isIP } from 'node:net';
import { requireVnpay, validateVnpayConfig, type VnpayConfig } from './vnpay-config';
import { canonicalize, parseRawQuery, signParameters, verifySignature } from './vnpay-signing';

// Whole VND from an authoritative Order snapshot, never an HTTP amount DTO.
export function toVnpayAmount(orderTotalVnd: string): string {
  requireVnpay(typeof orderTotalVnd === 'string' && /^[1-9]\d{0,9}$/.test(orderTotalVnd));
  const amount = BigInt(orderTotalVnd) * 100n;
  requireVnpay(amount <= 999999999999n);
  return amount.toString();
}

function validDate(value: string): boolean {
  if (!/^\d{14}$/.test(value)) return false;
  const [year, month, day, hour, minute, second] = [value.slice(0, 4), value.slice(4, 6),
    value.slice(6, 8), value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day && date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

export interface TrustedPaymentSnapshot {
  readonly orderTotalVnd: string;
  readonly txnRef: string;
  /** Provider wall-clock format yyyyMMddHHmmss, Asia/Ho_Chi_Minh (UTC+7). */
  readonly createDate: string;
  readonly expireDate: string;
  readonly customerIp: string;
}

export function buildPaymentUrl(config: VnpayConfig, snapshot: TrustedPaymentSnapshot): string {
  config = validateVnpayConfig(config);
  requireVnpay(/^[a-f0-9]{32}$/.test(snapshot.txnRef) && isIP(snapshot.customerIp) !== 0);
  requireVnpay(validDate(snapshot.createDate) && validDate(snapshot.expireDate) && snapshot.expireDate > snapshot.createDate);
  const parameters = {
    vnp_Version: config.version, vnp_Command: 'pay', vnp_TmnCode: config.merchantCode,
    vnp_Amount: toVnpayAmount(snapshot.orderTotalVnd), vnp_CurrCode: 'VND',
    vnp_TxnRef: snapshot.txnRef, vnp_OrderInfo: `Thanh toan BrewLite ${snapshot.txnRef}`,
    vnp_OrderType: 'other', vnp_Locale: 'vn', vnp_ReturnUrl: config.returnUrl,
    vnp_IpAddr: snapshot.customerIp, vnp_CreateDate: snapshot.createDate, vnp_ExpireDate: snapshot.expireDate,
  };
  return `${config.paymentUrl}?${canonicalize(parameters)}&vnp_SecureHash=${signParameters(parameters, config.hashSecret)}`;
}

export type ProviderOutcome = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'REVIEW';
// Interpretation is evidence classification only; it cannot settle an Order.
export function interpretPayStatus(responseCode: string, transactionStatus: string, transactionNo: string): ProviderOutcome {
  if (!/^\d{2}$/.test(responseCode) || !/^\d{2}$/.test(transactionStatus) || !/^\d{1,15}$/.test(transactionNo)) return 'REVIEW';
  if (responseCode === '07') return 'REVIEW';
  if (transactionStatus === '01') return 'UNKNOWN';
  if (responseCode === '00' && transactionStatus === '00') return /[1-9]/.test(transactionNo) ? 'SUCCEEDED' : 'REVIEW';
  if (transactionStatus === '02' && ['09', '10', '11', '12', '13', '24', '51', '65', '75', '79'].includes(responseCode)) return 'FAILED';
  return 'REVIEW';
}

const required = ['vnp_TmnCode', 'vnp_Amount', 'vnp_BankCode', 'vnp_OrderInfo', 'vnp_TransactionNo',
  'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TxnRef', 'vnp_SecureHash'];
const allowed = new Set([...required, 'vnp_BankTranNo', 'vnp_CardType', 'vnp_PayDate', 'vnp_SecureHashType', 'vnp_CurrCode']);

export interface VerifiedPayEvidence {
  readonly parameters: Readonly<Record<string, string>>;
  readonly outcome: ProviderOutcome;
}

// Caller must obtain expected ref/amount from durable server-owned state in a later phase.
// Neither this function nor a valid browser Return authorizes financial effects.
export function verifyPayCallback(rawQuery: string, config: VnpayConfig,
  expected: Pick<TrustedPaymentSnapshot, 'txnRef' | 'orderTotalVnd'>): VerifiedPayEvidence {
  config = validateVnpayConfig(config);
  const fields = parseRawQuery(rawQuery);
  requireVnpay(Object.keys(fields).every(key => allowed.has(key)) && required.every(key => Object.hasOwn(fields, key)));
  requireVnpay(!fields.vnp_SecureHashType || /^HmacSHA512$/i.test(fields.vnp_SecureHashType));
  const signature = fields.vnp_SecureHash;
  delete fields.vnp_SecureHash;
  delete fields.vnp_SecureHashType;
  requireVnpay(verifySignature(fields, signature, config.hashSecret));
  requireVnpay(fields.vnp_TmnCode === config.merchantCode && /^[a-f0-9]{32}$/.test(expected.txnRef) &&
    fields.vnp_TxnRef === expected.txnRef && fields.vnp_Amount === toVnpayAmount(expected.orderTotalVnd));
  requireVnpay(/^\d{1,12}$/.test(fields.vnp_Amount) && /^\d{1,15}$/.test(fields.vnp_TransactionNo) &&
    /^\d{2}$/.test(fields.vnp_ResponseCode) && /^\d{2}$/.test(fields.vnp_TransactionStatus) &&
    /^[A-Za-z0-9]{3,20}$/.test(fields.vnp_BankCode) &&
    /^[A-Za-z0-9 ]{1,255}$/.test(fields.vnp_OrderInfo));
  requireVnpay(!fields.vnp_PayDate || validDate(fields.vnp_PayDate));
  requireVnpay(!fields.vnp_CurrCode || fields.vnp_CurrCode === 'VND');
  requireVnpay(!fields.vnp_CardType || /^[A-Za-z]{2,20}$/.test(fields.vnp_CardType));
  requireVnpay(!fields.vnp_BankTranNo || /^[A-Za-z0-9]{1,255}$/.test(fields.vnp_BankTranNo));
  return Object.freeze({ parameters: Object.freeze(fields), outcome: interpretPayStatus(
    fields.vnp_ResponseCode, fields.vnp_TransactionStatus, fields.vnp_TransactionNo) });
}
