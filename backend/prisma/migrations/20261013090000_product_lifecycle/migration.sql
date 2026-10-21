-- AD01/A04: additive lifecycle only. Existing rows default active; do not alter
-- stock/prices/options/Cart or Order/Payment/Loyalty history.
ALTER TABLE "products" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
