import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
export function requireIdempotencyKey(key: string | undefined): asserts key is string {
  if (!key) throw new BadRequestException({ code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key required' });
  if (!/^[\x21-\x7e]{1,128}$/.test(key)) throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid Idempotency-Key' });
}
export function replayResult(claim: { requestHash: string; state: string; responseBody: Prisma.JsonValue | null }, hash: string) {
  if (claim.requestHash !== hash) throw new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key already used with another request' });
  if (claim.state !== 'COMPLETED' || claim.responseBody === null) throw new ConflictException({ code: 'IDEMPOTENCY_IN_PROGRESS', message: 'Retry the same key later' });
  return { body: claim.responseBody, replayed: true };
}
