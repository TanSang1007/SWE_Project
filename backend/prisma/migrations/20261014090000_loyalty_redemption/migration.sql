-- D43/L00: additive cutover. Run with business writes paused and compatible writers.
BEGIN;
CREATE TYPE "LoyaltyRedemptionState" AS ENUM ('NONE','RESERVED','RELEASED','SETTLED','REFUNDED');
CREATE TYPE "LoyaltyEntryKind" AS ENUM ('OPENING','RESERVE','SETTLE','RELEASE','EARN','REFUND','REVERSE');
ALTER TABLE users ADD COLUMN loyalty_debt BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT users_loyalty_debt_check CHECK (loyalty_debt >= 0),
  ADD CONSTRAINT users_loyalty_available_debt_check CHECK (loyalty_points = 0 OR loyalty_debt = 0);
ALTER TABLE orders
  ADD COLUMN redeemed_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN loyalty_discount_amount NUMERIC(12,0) NOT NULL DEFAULT 0,
  ADD COLUMN redemption_state "LoyaltyRedemptionState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN reservation_cycle INTEGER NOT NULL DEFAULT 0,
  DROP CONSTRAINT orders_total_check,
  ADD CONSTRAINT orders_total_check CHECK (total >= 0 AND total = subtotal-discount_amount-loyalty_discount_amount),
  ADD CONSTRAINT orders_loyalty_discount_check CHECK (redeemed_points >= 0 AND loyalty_discount_amount = 100::NUMERIC*redeemed_points
    AND loyalty_discount_amount >= 0 AND loyalty_discount_amount <= subtotal-discount_amount),
  ADD CONSTRAINT orders_loyalty_state_check CHECK (
    (redeemed_points = 0 AND redemption_state = 'NONE' AND reservation_cycle = 0)
    OR (redeemed_points > 0 AND reservation_cycle > 0 AND (
      (status = 'PENDING' AND redemption_state = 'RESERVED' AND paid_at IS NULL)
      OR (status = 'PAYMENT_FAILED' AND redemption_state = 'RELEASED' AND paid_at IS NULL)
      OR (status IN ('PAID','PREPARING','READY','COMPLETED') AND redemption_state = 'SETTLED' AND paid_at IS NOT NULL)
      OR (status = 'CANCELLED' AND ((paid_at IS NULL AND redemption_state = 'RELEASED') OR (paid_at IS NOT NULL AND redemption_state = 'REFUNDED')))
    )));
CREATE TABLE loyalty_entries (
  id UUID NOT NULL PRIMARY KEY,
  sequence BIGSERIAL NOT NULL,
  user_id UUID NOT NULL,
  order_id UUID,
  payment_id UUID,
  kind "LoyaltyEntryKind" NOT NULL,
  cycle INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL,
  available_delta INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL,
  debt_delta BIGINT NOT NULL,
  effect_key TEXT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT loyalty_entries_user_id_fkey FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT loyalty_entries_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT loyalty_entries_payment_id_fkey FOREIGN KEY(payment_id) REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT loyalty_entries_bounds_check CHECK (sequence>0 AND cycle>=0 AND points>=0
    AND available_delta>=-2147483647 AND reserved_delta>=-2147483647 AND length(effect_key) BETWEEN 1 AND 96),
  CONSTRAINT loyalty_entries_attribution_check CHECK (
    (kind='OPENING' AND order_id IS NULL AND payment_id IS NULL AND cycle=0 AND effect_key='OPENING:'||user_id::TEXT)
    OR (order_id IS NOT NULL AND (
      (kind='RESERVE' AND points>0 AND cycle=1 AND payment_id IS NULL AND effect_key='CREATE_ORDER:'||order_id::TEXT)
      OR (kind='RESERVE' AND points>0 AND cycle>1 AND payment_id IS NOT NULL AND effect_key='PAY_ORDER:'||payment_id::TEXT)
      OR (kind='SETTLE' AND points>0 AND cycle>0 AND payment_id IS NOT NULL AND effect_key='PAY_ORDER:'||payment_id::TEXT)
      OR (kind='EARN' AND cycle=0 AND payment_id IS NOT NULL AND effect_key='PAY_ORDER:'||payment_id::TEXT)
      OR (kind='RELEASE' AND points>0 AND cycle>0 AND ((payment_id IS NULL AND effect_key='UNPAID_CANCEL:'||order_id::TEXT)
        OR (payment_id IS NOT NULL AND effect_key='PAY_ORDER:'||payment_id::TEXT)))
      OR (kind='REFUND' AND points>0 AND cycle=0 AND payment_id IS NULL AND effect_key='PAID_CANCEL:'||order_id::TEXT)
      OR (kind='REVERSE' AND cycle=0 AND payment_id IS NULL AND effect_key='PAID_CANCEL:'||order_id::TEXT)
    ))),
  CONSTRAINT loyalty_entries_deltas_check CHECK (
    (kind='OPENING' AND available_delta=points AND reserved_delta=0 AND debt_delta=0)
    OR (kind='RESERVE' AND available_delta=-points::BIGINT AND reserved_delta=points AND debt_delta=0)
    OR (kind='SETTLE' AND available_delta=0 AND reserved_delta=-points::BIGINT AND debt_delta=0)
    OR (kind IN ('EARN','REFUND','RELEASE') AND available_delta BETWEEN 0 AND points
      AND debt_delta BETWEEN -points::BIGINT AND 0 AND available_delta::NUMERIC-debt_delta::NUMERIC=points
      AND ((kind='RELEASE' AND reserved_delta=-points::BIGINT) OR (kind IN ('EARN','REFUND') AND reserved_delta=0)))
    OR (kind='REVERSE' AND available_delta BETWEEN -points::BIGINT AND 0 AND reserved_delta=0
      AND debt_delta BETWEEN 0 AND points AND -available_delta::NUMERIC+debt_delta::NUMERIC=points)
  )
);
CREATE UNIQUE INDEX loyalty_entries_sequence_key ON loyalty_entries(sequence);
CREATE UNIQUE INDEX loyalty_entries_effect_key_kind_key ON loyalty_entries(effect_key,kind);
CREATE UNIQUE INDEX loyalty_entries_order_id_kind_cycle_key ON loyalty_entries(order_id,kind,cycle);
CREATE UNIQUE INDEX loyalty_entries_terminal_effect_key ON loyalty_entries(order_id,kind) WHERE kind IN ('SETTLE','EARN','REFUND','REVERSE');
CREATE INDEX loyalty_entries_user_id_sequence_idx ON loyalty_entries(user_id,sequence DESC);
CREATE INDEX loyalty_entries_order_id_sequence_idx ON loyalty_entries(order_id,sequence);
CREATE FUNCTION loyalty_entries_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Loyalty journal is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER loyalty_entries_immutable BEFORE UPDATE OR DELETE ON loyalty_entries FOR EACH ROW EXECUTE FUNCTION loyalty_entries_immutable();
-- Exact opening only: old earning/spending history is not manufactured.
INSERT INTO loyalty_entries(id,user_id,kind,points,available_delta,reserved_delta,debt_delta,effect_key)
SELECT gen_random_uuid(),id,'OPENING',loyalty_points,loyalty_points,0,0,'OPENING:'||id::TEXT FROM users ORDER BY id;
COMMIT;
