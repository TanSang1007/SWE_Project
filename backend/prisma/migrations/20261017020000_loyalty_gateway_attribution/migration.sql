-- FIX01 approved attribution amendment. Candidate: isolated validation only.
-- No historical row rewrite; the full original source predicate is retained.
BEGIN;
ALTER TABLE loyalty_entries
  ADD COLUMN payment_attempt_id UUID,
  ADD CONSTRAINT loyalty_entries_payment_attempt_id_fkey FOREIGN KEY(payment_attempt_id)
    REFERENCES payment_attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  DROP CONSTRAINT loyalty_entries_attribution_check,
  ADD CONSTRAINT loyalty_entries_attribution_check CHECK (
    (payment_attempt_id IS NULL AND (
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
    ))))
    OR (payment_attempt_id IS NOT NULL AND payment_id IS NULL AND order_id IS NOT NULL
      AND kind='RESERVE' AND points>0 AND cycle>1
      AND effect_key='GATEWAY_ATTEMPT:'||payment_attempt_id::TEXT)
  );
CREATE UNIQUE INDEX loyalty_entries_payment_attempt_id_key ON loyalty_entries(payment_attempt_id);
-- A reservation cycle can be released OR settled, never both, for all sources.
CREATE UNIQUE INDEX loyalty_entries_cycle_outcome_key ON loyalty_entries(order_id,cycle)
  WHERE kind IN ('RELEASE','SETTLE');

-- Insert-time attribution guard; aggregate accounting and locks remain caller duties.
CREATE FUNCTION loyalty_entries_gateway_attribution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o orders%ROWTYPE;
  a payment_attempts%ROWTYPE;
  p payments%ROWTYPE;
  r loyalty_entries%ROWTYPE;
BEGIN
  IF NEW.kind IN ('RELEASE','SETTLE') THEN
    SELECT * INTO r FROM loyalty_entries
      WHERE order_id=NEW.order_id AND kind='RESERVE' AND cycle=NEW.cycle;
    -- Unresolved money cannot be released through the legacy unpaid/Mock path.
    IF EXISTS (SELECT 1 FROM payment_attempts WHERE order_id=NEW.order_id
        AND application_state IN ('PENDING','REVIEW'))
      OR EXISTS (SELECT 1 FROM payment_verifications v JOIN payment_attempts x ON x.id=v.attempt_id
        WHERE x.order_id=NEW.order_id AND v.state='VERIFIED' AND v.processed_at IS NULL) THEN
      RAISE EXCEPTION 'Gateway outcome unresolved' USING ERRCODE='23514';
    END IF;
  END IF;
  IF NEW.payment_id IS NOT NULL THEN
    SELECT * INTO p FROM payments WHERE id=NEW.payment_id;
  END IF;
  IF NEW.payment_attempt_id IS NULL AND (p.provider IS NULL OR p.provider<>'VNPAY_SANDBOX') THEN
    IF NEW.kind IN ('RELEASE','SETTLE') AND r.payment_attempt_id IS NOT NULL THEN
      RAISE EXCEPTION 'Gateway reservation requires matching terminal payment' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO o FROM orders WHERE id=NEW.order_id;
  SELECT * INTO a FROM payment_attempts
    WHERE id=COALESCE(NEW.payment_attempt_id,p.gateway_attempt_id);
  IF o.id IS NULL OR a.id IS NULL OR o.user_id<>NEW.user_id OR a.order_id<>o.id
    OR a.provider<>'VNPAY_SANDBOX' OR a.amount<>o.total
    OR NOT EXISTS (SELECT 1 FROM idempotency_requests c WHERE c.id=a.idempotency_request_id
      AND c.user_id=o.user_id AND c.order_id=o.id AND c.operation='PAY_ORDER') THEN
    RAISE EXCEPTION 'Gateway attribution binding mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.payment_attempt_id IS NOT NULL THEN
    IF NEW.kind<>'RESERVE' OR NEW.payment_id IS NOT NULL OR NEW.cycle<=1
      OR NEW.cycle<>o.reservation_cycle OR NEW.points<>o.redeemed_points
      OR o.status<>'PENDING' OR o.redemption_state<>'RESERVED'
      OR a.state<>'AWAITING' OR a.application_state<>'PENDING'
      OR EXISTS (SELECT 1 FROM payments WHERE gateway_attempt_id=a.id)
      OR EXISTS (SELECT 1 FROM payment_verifications WHERE attempt_id=a.id AND state='VERIFIED')
      OR NOT EXISTS (SELECT 1 FROM loyalty_entries e JOIN payments prev ON prev.id=e.payment_id
        WHERE e.order_id=o.id AND e.user_id=o.user_id AND e.kind='RELEASE' AND e.cycle=NEW.cycle-1
          AND prev.order_id=o.id AND prev.user_id=o.user_id AND prev.status='FAILED' AND prev.amount=o.total) THEN
      RAISE EXCEPTION 'Invalid gateway reservation cycle or state' USING ERRCODE='23514';
    END IF;
  ELSE
    IF p.user_id<>o.user_id OR p.order_id<>o.id OR p.amount<>o.total
      OR p.idempotency_request_id<>a.idempotency_request_id
      OR a.application_state<>'APPLIED' OR a.verified_at IS NULL OR a.applied_at IS NULL
      OR NOT EXISTS (SELECT 1 FROM payment_verifications WHERE attempt_id=a.id
        AND state='VERIFIED' AND processed_at IS NOT NULL)
      OR NOT ((p.status='SUCCEEDED' AND a.state='SUCCEEDED') OR (p.status='FAILED' AND a.state='FAILED')) THEN
      RAISE EXCEPTION 'Terminal gateway source not verified and applied' USING ERRCODE='23514';
    END IF;
    IF NEW.kind IN ('RELEASE','SETTLE') THEN
      IF r.id IS NULL OR r.user_id<>NEW.user_id OR r.points<>NEW.points OR NEW.points<>o.redeemed_points
        OR NEW.cycle<>o.reservation_cycle
        OR (r.payment_attempt_id IS NOT NULL AND r.payment_attempt_id<>a.id)
        OR (r.payment_attempt_id IS NULL AND (r.cycle<>1 OR r.payment_id IS NOT NULL))
        OR (NEW.kind='RELEASE' AND (p.status<>'FAILED' OR o.status<>'PAYMENT_FAILED' OR o.redemption_state<>'RELEASED'))
        OR (NEW.kind='SETTLE' AND (p.status<>'SUCCEEDED' OR o.status<>'PAID' OR o.redemption_state<>'SETTLED')) THEN
        RAISE EXCEPTION 'Gateway outcome does not match reserved cycle' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.kind<>'EARN' OR p.status<>'SUCCEEDED' OR o.status<>'PAID'
      OR NEW.points<>floor(o.total/10000) THEN
      RAISE EXCEPTION 'Invalid terminal gateway effect' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER loyalty_entries_gateway_attribution BEFORE INSERT ON loyalty_entries
  FOR EACH ROW EXECUTE FUNCTION loyalty_entries_gateway_attribution();
-- Once a terminal Payment is a journal source, its gateway binding cannot drift.
CREATE FUNCTION payments_preserve_gateway_loyalty_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.provider='VNPAY_SANDBOX' AND NEW IS DISTINCT FROM OLD
    AND EXISTS (SELECT 1 FROM loyalty_entries WHERE payment_id=OLD.id) THEN
    RAISE EXCEPTION 'Attributed gateway payment is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_preserve_gateway_loyalty_source BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_preserve_gateway_loyalty_source();
COMMIT;
