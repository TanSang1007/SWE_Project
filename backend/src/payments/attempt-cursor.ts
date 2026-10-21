import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
type Position = {
    owner: string;
    order: string;
    date: string;
    id: string;
    version: 1;
};
const key = (secret: string) => Buffer.from(hkdfSync('sha256', secret, '', 'BrewLite:PaymentAttempts:v1', 32));
export function encodeAttemptCursor(secret: string, owner: string, order: string, date: Date, id: string) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
    const p: Position = { owner, order, date: date.toISOString(), id, version: 1 };
    return Buffer.concat([nonce, cipher.update(JSON.stringify(p)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function decodeAttemptCursor(secret: string, owner: string, order: string, cursor: string) {
    try {
        if (!/^[A-Za-z0-9_-]{1,768}$/.test(cursor))
            throw Error();
        const raw = Buffer.from(cursor, 'base64url');
        if (raw.length <= 28 || raw.toString('base64url') !== cursor)
            throw Error();
        const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(-16));
        const p = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString('utf8')) as Position;
        if (!p || Object.keys(p).sort().join(',') !== 'date,id,order,owner,version' || p.version !== 1 || p.owner !== owner || p.order !== order
            || typeof p.date !== 'string' || new Date(p.date).toISOString() !== p.date || typeof p.id !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id))
            throw Error();
        return { date: new Date(p.date), id: p.id };
    }
    catch {
        throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid payment attempts cursor' });
    }
}
