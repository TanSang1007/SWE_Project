import { createHash } from 'node:crypto';
import { parseRawQuery, canonicalize, verifySignature } from './vnpay-signing';
import { verifyPayCallback, type ProviderOutcome } from './vnpay-pay';
import type { VnpayConfig } from './vnpay-config';
export class IpnRejection extends Error {
    constructor(readonly code: '01' | '04' | '97' | '99') { super('IPN rejected'); }
}
const allowed = new Set(['vnp_TmnCode', 'vnp_Amount', 'vnp_BankCode', 'vnp_OrderInfo', 'vnp_TransactionNo', 'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TxnRef',
    'vnp_SecureHash', 'vnp_BankTranNo', 'vnp_CardType', 'vnp_PayDate', 'vnp_SecureHashType', 'vnp_CurrCode']);
export function authenticateIpn(raw: string, config: VnpayConfig) {
    let fields: Record<string, string>;
    try {
        fields = parseRawQuery(raw);
    }
    catch {
        throw new IpnRejection('99');
    }
    if (!Object.keys(fields).every(k => allowed.has(k)) || (fields.vnp_SecureHashType && !/^HmacSHA512$/i.test(fields.vnp_SecureHashType)))
        throw new IpnRejection('99');
    if (!['vnp_TmnCode', 'vnp_Amount', 'vnp_BankCode', 'vnp_OrderInfo', 'vnp_TransactionNo', 'vnp_ResponseCode', 'vnp_TransactionStatus', 'vnp_TxnRef'].every(k => Object.hasOwn(fields, k)))
        throw new IpnRejection('99');
    const signed = { ...fields };
    delete signed.vnp_SecureHash;
    delete signed.vnp_SecureHashType;
    if (!verifySignature(signed, fields.vnp_SecureHash, config.hashSecret) || fields.vnp_TmnCode !== config.merchantCode)
        throw new IpnRejection('97');
    if (!/^[a-f0-9]{32}$/.test(fields.vnp_TxnRef ?? '') || !/^\d{1,12}$/.test(fields.vnp_Amount ?? ''))
        throw new IpnRejection('99');
    return fields;
}
export function verifyIpn(raw: string, config: VnpayConfig, ref: string, amount: string) {
    try {
        const verified = verifyPayCallback(raw, config, { txnRef: ref, orderTotalVnd: amount });
        const p = verified.parameters;
        const payload: Record<string, string> = { merchantCode: p.vnp_TmnCode, txnRef: p.vnp_TxnRef, amountMinor: p.vnp_Amount,
            responseCode: p.vnp_ResponseCode, transactionStatus: p.vnp_TransactionStatus, transactionNo: p.vnp_TransactionNo, bankCode: p.vnp_BankCode };
        if (p.vnp_PayDate)
            payload.payDate = p.vnp_PayDate;
        return { payload, hash: createHash('sha256').update(canonicalize(p)).digest('hex'), outcome: verified.outcome };
    }
    catch {
        throw new IpnRejection('99');
    }
}
export type IpnEvidence = {
    payload: Record<string, string>;
    hash: string;
    outcome: ProviderOutcome;
};
export function providerPaidAt(value: string | undefined) {
    return value ? new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)), Number(value.slice(8, 10)) - 7, Number(value.slice(10, 12)), Number(value.slice(12, 14)))) : null;
}
