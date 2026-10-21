import { BadRequestException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
type Position = {
    version: 1;
    owner: string;
    U: string;
    last: string;
};
const invalid = () => new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid loyalty history cursor' });
function key(secret: string) { return Buffer.from(hkdfSync('sha256', secret, '', 'BrewLite:LoyaltyHistory:v1', 32)); }
export function encodeCursor(secret: string, owner: string, upper: bigint, last: bigint) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
    const data: Position = { version: 1, owner, U: upper.toString(), last: last.toString() };
    return Buffer.concat([nonce, cipher.update(JSON.stringify(data), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function decodeCursor(secret: string, owner: string, cursor: string): {
    upper: bigint;
    last: bigint;
} {
    try {
        if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))
            throw invalid();
        const raw = Buffer.from(cursor, 'base64url');
        if (raw.length <= 28 || raw.toString('base64url') !== cursor)
            throw invalid();
        const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(-16));
        const p = JSON.parse(Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString('utf8')) as Position;
        if (!p || Object.keys(p).sort().join(',') !== 'U,last,owner,version' || p.version !== 1 || p.owner !== owner
            || typeof p.U !== 'string' || typeof p.last !== 'string' || !/^[1-9]\d{0,18}$/.test(p.U) || !/^[1-9]\d{0,18}$/.test(p.last))
            throw invalid();
        const upper = BigInt(p.U), last = BigInt(p.last);
        if (last > upper || upper > 9223372036854775807n)
            throw invalid();
        return { upper, last };
    }
    catch {
        throw invalid();
    }
}
