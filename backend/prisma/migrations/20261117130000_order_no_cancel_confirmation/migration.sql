-- Additive column for customer early confirmation of no cancellation on PAID orders.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS no_cancel_confirmed_at TIMESTAMPTZ(6);
