-- P00 D07: additive labels only; commit before any constraint uses them.
-- Candidate: P01-B1 authorizes isolated validation, not development apply.
BEGIN;
ALTER TYPE "PaymentMethod" ADD VALUE 'VNPAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'ZERO_TOTAL';
COMMIT;
