-- Commit the enum extension before a subsequent migration uses its new value.
ALTER TYPE "IdempotencyOperation" ADD VALUE 'ADJUST_INVENTORY';
