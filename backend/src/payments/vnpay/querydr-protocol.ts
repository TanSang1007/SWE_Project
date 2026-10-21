import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { toVnpayAmount, type ProviderOutcome } from './vnpay-pay';
import { validateVnpayConfig, type VnpayConfig } from './vnpay-config';

export class QueryDrError extends Error {
  constructor(readonly code: string) { super('QueryDr unavailable'); }
}
export const QUERYDR_RESPONSE_FIELDS = ['ResponseId', 'Command', 'ResponseCode', 'Message', 'TmnCode', 'TxnRef', 'Amount',
  'BankCode', 'PayDate', 'TransactionNo', 'TransactionType', 'TransactionStatus', 'OrderInfo', 'PromotionCode', 'PromotionAmount'].map(k => 'vnp_' + k);
const requestFields = ['RequestId', 'Version', 'Command', 'TmnCode', 'TxnRef', 'TransactionDate', 'CreateDate', 'IpAddr', 'OrderInfo'].map(k => 'vnp_' + k);
const optional = new Set(['vnp_Command', 'vnp_PayDate', 'vnp_PromotionCode', 'vnp_PromotionAmount']);
function requireField(ok: unknown): asserts ok { if (!ok) throw new QueryDrError('MALFORMED_RESPONSE'); }
export function providerDate(now: Date): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 19).replace(/[-T:]/g, '');
}
function validDate(s: string) {
  if (!/^\d{14}$/.test(s)) return false;
  const parts = [s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)].map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
  return parts[0] >= 2000 && providerDate(new Date(d.getTime() - 7 * 3600000)) === s;
}
// QueryDr is a flat JSON object of string scalars. Preserve duplicate decoded keys
// before JSON.parse could overwrite them, including escaped equivalent key names.
export function parseQueryDr(raw: string): Record<string, string> {
  requireField(typeof raw === 'string' && Buffer.byteLength(raw, 'utf8') <= 16384);
  try { JSON.parse(raw); } catch { throw new QueryDrError('INVALID_JSON'); }
  // JSON string grammar must reject literal U+0000..001F before decoding.
  // eslint-disable-next-line no-control-regex
  const token = /\s*("(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*")/y;
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let i = 0;
  const space = () => { while (/[ \t\r\n]/.test(raw[i] ?? '') && i < raw.length) i++; };
  const char = (c: string) => { space(); requireField(raw[i++] === c); };
  const string = () => {
    token.lastIndex = i;
    const m = token.exec(raw); requireField(m);
    i = token.lastIndex;
    const s: unknown = JSON.parse(m[1]); requireField(typeof s === 'string');
    requireField(!/[\p{Cc}|]/u.test(s) && Buffer.from(s, 'utf8').toString('utf8') === s);
    return s;
  };
  char('{'); space();
  requireField(raw[i] !== '}');
  for (let count = 0; ; count++) {
    requireField(count < 16);
    const key = string();
    requireField([...QUERYDR_RESPONSE_FIELDS, 'vnp_SecureHash'].includes(key) && !Object.hasOwn(result, key));
    char(':'); result[key] = string(); space();
    if (raw[i] === '}') { i++; break; }
    char(',');
  }
  space(); requireField(i === raw.length);
  return result;
}
export function canonicalQueryDrResponse(p: Readonly<Record<string, string>>): string {
  return QUERYDR_RESPONSE_FIELDS.map(k => p[k] ?? '').join('|');
}
export function buildQueryDr(config: VnpayConfig, snapshot: { txnRef: string; createDate: string; amount: string }, ip: string,
  now = new Date(), requestId = randomUUID().replaceAll('-', '')) {
  config = validateVnpayConfig(config);
  toVnpayAmount(snapshot.amount); // Reject zero/unsupported gateway amount before outbound.
  requireField(/^[a-f0-9]{32}$/.test(snapshot.txnRef) && validDate(snapshot.createDate) && isIP(ip) !== 0 && /^[a-f0-9]{32}$/.test(requestId));
  const p: Record<string, string> = { vnp_RequestId: requestId, vnp_Version: '2.1.0', vnp_Command: 'querydr', vnp_TmnCode: config.merchantCode,
    vnp_TxnRef: snapshot.txnRef, vnp_TransactionDate: snapshot.createDate, vnp_CreateDate: providerDate(now), vnp_IpAddr: ip,
    vnp_OrderInfo: 'Truy van BrewLite ' + snapshot.txnRef };
  p.vnp_SecureHash = createHmac('sha512', config.hashSecret).update(requestFields.map(k => p[k]).join('|'), 'utf8').digest('hex');
  return p;
}
export function queryDrOutcome(p: Record<string, string>): ProviderOutcome {
  if (p.responseCode !== '00') return p.responseCode === '91' || ['94', '97', '99', '02', '03'].includes(p.responseCode) ? 'UNKNOWN' : 'REVIEW';
  if (p.transactionType !== '01') return 'REVIEW';
  if (p.transactionStatus === '00') return /[1-9]/.test(p.transactionNo) ? 'SUCCEEDED' : 'REVIEW';
  if (p.transactionStatus === '02') return 'FAILED';
  if (p.transactionStatus === '01') return 'UNKNOWN';
  return 'REVIEW';
}
export function verifyQueryDr(raw: string, config: VnpayConfig, expected: { txnRef: string; amount: string }) {
  config = validateVnpayConfig(config);
  const p = parseQueryDr(raw);
  for (const key of QUERYDR_RESPONSE_FIELDS) if (!optional.has(key)) requireField(typeof p[key] === 'string' && p[key].length > 0);
  requireField(/^[a-fA-F0-9]{128}$/.test(p.vnp_SecureHash ?? ''));
  const canonical = canonicalQueryDrResponse(p);
  const digest = createHmac('sha512', config.hashSecret).update(canonical, 'utf8').digest();
  if (!timingSafeEqual(digest, Buffer.from(p.vnp_SecureHash, 'hex'))) throw new QueryDrError('INVALID_SIGNATURE');
  requireField(/^[A-Za-z0-9]{1,32}$/.test(p.vnp_ResponseId) && (!p.vnp_Command || p.vnp_Command === 'querydr'));
  requireField(p.vnp_TmnCode === config.merchantCode && p.vnp_TxnRef === expected.txnRef && /^[a-f0-9]{32}$/.test(expected.txnRef));
  requireField(/^\d{1,12}$/.test(p.vnp_Amount) && p.vnp_Amount === toVnpayAmount(expected.amount));
  requireField(/^\d{1,15}$/.test(p.vnp_TransactionNo) && /^\d{2}$/.test(p.vnp_TransactionType)
    && /^\d{2}$/.test(p.vnp_TransactionStatus) && /^\d{2}$/.test(p.vnp_ResponseCode));
  requireField(/^[A-Za-z0-9]{3,20}$/.test(p.vnp_BankCode) && p.vnp_Message.length <= 255 && p.vnp_OrderInfo.length <= 255);
  requireField(!p.vnp_PayDate || validDate(p.vnp_PayDate));
  requireField(!p.vnp_PromotionCode || /^[A-Za-z0-9]{1,12}$/.test(p.vnp_PromotionCode));
  requireField(!p.vnp_PromotionAmount || /^\d{1,12}$/.test(p.vnp_PromotionAmount));
  if (p.vnp_ResponseCode !== '00') throw new QueryDrError('PROVIDER_API_' + p.vnp_ResponseCode);
  requireField(p.vnp_TransactionStatus !== '00' || /[1-9]/.test(p.vnp_TransactionNo));
  const payload: Record<string, string> = { merchantCode: p.vnp_TmnCode, txnRef: p.vnp_TxnRef, amountMinor: p.vnp_Amount,
    responseCode: p.vnp_ResponseCode, transactionStatus: p.vnp_TransactionStatus, transactionNo: p.vnp_TransactionNo,
    transactionType: p.vnp_TransactionType, responseId: p.vnp_ResponseId, bankCode: p.vnp_BankCode };
  for (const [wire, key] of [['vnp_PayDate', 'payDate'], ['vnp_PromotionCode', 'promotionCode'], ['vnp_PromotionAmount', 'promotionAmount']])
    if (p[wire]) payload[key] = p[wire];
  return { payload, hash: createHash('sha256').update(canonical, 'utf8').digest('hex'), outcome: queryDrOutcome(payload) };
}
