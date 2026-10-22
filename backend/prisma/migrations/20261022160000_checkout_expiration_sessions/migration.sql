-- Additive only. Existing orders retain NULL deadlines and are not expired by
-- the new worker. No rewrite of historical payment/attempt evidence.
BEGIN;
SET LOCAL lock_timeout = '200ms';
ALTER TABLE orders
  ADD COLUMN payment_started_at timestamptz(6),
  ADD COLUMN payment_expires_at timestamptz(6),
  ADD COLUMN payment_expired_at timestamptz(6),
  ADD COLUMN cancellation_reason varchar(64),
  ADD CONSTRAINT order_payment_deadline_check CHECK (
    (payment_started_at IS NULL AND payment_expires_at IS NULL)
    OR (payment_started_at IS NOT NULL AND payment_expires_at IS NOT NULL AND payment_expires_at = payment_started_at + interval '10 minutes')
  );
CREATE INDEX orders_payment_deadline_idx ON orders(payment_expires_at, id)
  WHERE status IN ('PENDING', 'PAYMENT_FAILED') AND payment_expires_at IS NOT NULL;
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL,
  previous_token_hash char(64),
  expires_at timestamptz(6) NOT NULL,
  revoked_at timestamptz(6),
  created_at timestamptz(6) NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
COMMIT;
