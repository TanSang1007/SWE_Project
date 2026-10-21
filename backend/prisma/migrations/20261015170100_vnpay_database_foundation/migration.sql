-- P00 D01-D08: additive foundation; no financial effects or fabricated history.
-- Candidate: P01-B1 authorizes isolated validation, not development apply.
BEGIN;
CREATE TYPE "PaymentProvider" AS ENUM ('MOCK','VNPAY_SANDBOX','INTERNAL_ZERO');
CREATE TYPE "GatewayState" AS ENUM ('AWAITING','UNKNOWN','SUCCEEDED','FAILED');
CREATE TYPE "GatewayApplicationState" AS ENUM ('PENDING','APPLIED','REVIEW');
CREATE TYPE "VerificationSource" AS ENUM ('IPN','QUERYDR');
CREATE TYPE "VerificationState" AS ENUM ('REQUESTED','VERIFIED','UNRESOLVED');

CREATE TABLE payment_attempts (
  id UUID NOT NULL PRIMARY KEY,
  order_id UUID NOT NULL,
  idempotency_request_id UUID NOT NULL,
  provider "PaymentProvider" NOT NULL DEFAULT 'VNPAY_SANDBOX',
  merchant_code VARCHAR(8) NOT NULL,
  txn_ref VARCHAR(32) NOT NULL,
  amount NUMERIC(12,0) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'VND',
  state "GatewayState" NOT NULL DEFAULT 'AWAITING',
  application_state "GatewayApplicationState" NOT NULL DEFAULT 'PENDING',
  transaction_no VARCHAR(15),
  response_code CHAR(2),
  transaction_status CHAR(2),
  create_date CHAR(14) NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL,
  provider_paid_at TIMESTAMPTZ(6),
  verified_at TIMESTAMPTZ(6),
  applied_at TIMESTAMPTZ(6),
  review_reason VARCHAR(64),
  request_parameters JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_attempts_order_id_fkey FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT payment_attempts_idempotency_request_id_fkey FOREIGN KEY(idempotency_request_id) REFERENCES idempotency_requests(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT payment_attempts_provider_check CHECK (provider='VNPAY_SANDBOX' AND currency='VND'
    AND amount BETWEEN 1 AND 9999999999 AND txn_ref ~ '^[a-f0-9]{32}$' AND merchant_code ~ '^[A-Za-z0-9]{8}$'),
  CONSTRAINT payment_attempts_dates_check CHECK (expires_at>created_at AND create_date ~ '^[0-9]{14}$'),
  CONSTRAINT payment_attempts_application_check CHECK (
    (application_state='PENDING' AND applied_at IS NULL)
    OR (application_state='APPLIED' AND state IN ('SUCCEEDED','FAILED') AND applied_at IS NOT NULL)
    OR (application_state='REVIEW' AND review_reason IS NOT NULL AND length(btrim(review_reason))>0)),
  CONSTRAINT payment_attempts_provider_identifiers_check CHECK (
    (transaction_no IS NULL OR (transaction_no ~ '^[0-9]{1,15}$' AND transaction_no !~ '^0+$'))
    AND (response_code IS NULL OR response_code ~ '^[0-9]{2}$')
    AND (transaction_status IS NULL OR transaction_status ~ '^[0-9]{2}$')),
  -- Snapshot whitelist prevents accidentally persisting signed URLs/HashSecret.
  -- Calendar, callback allowlist and snapshot binding remain adapter validation.
  CONSTRAINT payment_attempts_request_parameters_check CHECK (
    jsonb_typeof(request_parameters)='object'
    AND request_parameters - ARRAY['vnp_Version','vnp_Command','vnp_TmnCode','vnp_Amount','vnp_CurrCode',
      'vnp_TxnRef','vnp_OrderInfo','vnp_OrderType','vnp_Locale','vnp_ReturnUrl','vnp_IpAddr','vnp_CreateDate','vnp_ExpireDate']::TEXT[] = '{}'::JSONB
    AND request_parameters ?& ARRAY['vnp_Version','vnp_Command','vnp_TmnCode','vnp_Amount','vnp_CurrCode',
      'vnp_TxnRef','vnp_OrderInfo','vnp_OrderType','vnp_Locale','vnp_ReturnUrl','vnp_IpAddr','vnp_CreateDate','vnp_ExpireDate']::TEXT[]
    AND NOT jsonb_path_exists(request_parameters, '$.* ? (@.type() != "string")'))
);
CREATE UNIQUE INDEX payment_attempts_idempotency_request_id_key ON payment_attempts(idempotency_request_id);
CREATE UNIQUE INDEX payment_attempts_txn_ref_key ON payment_attempts(txn_ref);
CREATE UNIQUE INDEX payment_attempts_merchant_code_transaction_no_key ON payment_attempts(merchant_code,transaction_no);
CREATE UNIQUE INDEX payment_attempts_one_pending_per_order_idx ON payment_attempts(order_id) WHERE application_state='PENDING';
CREATE INDEX payment_attempts_order_id_created_at_id_idx ON payment_attempts(order_id,created_at DESC,id DESC);

CREATE TABLE payment_verifications (
  id UUID NOT NULL PRIMARY KEY,
  attempt_id UUID NOT NULL,
  source "VerificationSource" NOT NULL,
  state "VerificationState" NOT NULL,
  request_id VARCHAR(32),
  query_create_date CHAR(14),
  payload_hash CHAR(64),
  payload JSONB,
  error_code VARCHAR(64),
  received_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TIMESTAMPTZ(6),
  processed_at TIMESTAMPTZ(6),
  CONSTRAINT payment_verifications_attempt_id_fkey FOREIGN KEY(attempt_id) REFERENCES payment_attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT payment_verifications_source_check CHECK (
    (source='IPN' AND state='VERIFIED' AND request_id IS NULL AND query_create_date IS NULL)
    OR (source='QUERYDR' AND request_id IS NOT NULL AND request_id ~ '^[a-f0-9]{32}$'
      AND query_create_date IS NOT NULL AND query_create_date ~ '^[0-9]{14}$')),
  CONSTRAINT payment_verifications_evidence_check CHECK (
    (state='VERIFIED' AND payload IS NOT NULL AND jsonb_typeof(payload)='object'
      AND payload_hash IS NOT NULL AND payload_hash ~ '^[a-f0-9]{64}$' AND verified_at IS NOT NULL)
    OR (state IN ('REQUESTED','UNRESOLVED') AND payload IS NULL AND payload_hash IS NULL AND verified_at IS NULL)),
  CONSTRAINT payment_verifications_processed_check CHECK (processed_at IS NULL OR state='VERIFIED'),
  -- Normalized evidence keys, not raw VNPAY query, card, BankTranNo, headers or secrets.
  CONSTRAINT payment_verifications_payload_check CHECK (payload IS NULL OR (
    payload - ARRAY['merchantCode','txnRef','amountMinor','responseCode','transactionStatus','transactionNo',
      'transactionType','payDate','bankCode','responseId','promotionCode','promotionAmount']::TEXT[] = '{}'::JSONB
    AND NOT jsonb_path_exists(payload, '$.* ? (@.type() != "string")')))
);
CREATE UNIQUE INDEX payment_verifications_request_id_key ON payment_verifications(request_id);
CREATE UNIQUE INDEX payment_verifications_attempt_id_source_payload_hash_key ON payment_verifications(attempt_id,source,payload_hash);
CREATE INDEX payment_verifications_attempt_id_received_at_id_idx ON payment_verifications(attempt_id,received_at,id);

ALTER TABLE payments
  ADD COLUMN provider "PaymentProvider" NOT NULL DEFAULT 'MOCK',
  ADD COLUMN gateway_attempt_id UUID,
  ADD COLUMN confirmed_at TIMESTAMPTZ(6),
  ADD CONSTRAINT payments_gateway_attempt_id_fkey FOREIGN KEY(gateway_attempt_id) REFERENCES payment_attempts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT payments_provider_check CHECK (
    (provider='MOCK' AND method IN ('WALLET','CARD') AND gateway_attempt_id IS NULL)
    OR (provider='VNPAY_SANDBOX' AND method='VNPAY' AND amount>0 AND gateway_attempt_id IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (provider='INTERNAL_ZERO' AND method='ZERO_TOTAL' AND amount=0 AND gateway_attempt_id IS NULL AND status='SUCCEEDED' AND confirmed_at IS NOT NULL)),
  ADD CONSTRAINT payments_vnpay_failure_code_check CHECK (provider<>'VNPAY_SANDBOX' OR status<>'FAILED' OR failure_code='VNPAY_DECLINED');
CREATE UNIQUE INDEX payments_gateway_attempt_id_key ON payments(gateway_attempt_id);

CREATE FUNCTION payment_attempts_preserve_initiation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id,NEW.order_id,NEW.idempotency_request_id,NEW.provider,NEW.merchant_code,NEW.txn_ref,
    NEW.amount,NEW.currency,NEW.create_date,NEW.expires_at,NEW.request_parameters,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.order_id,OLD.idempotency_request_id,OLD.provider,OLD.merchant_code,OLD.txn_ref,
    OLD.amount,OLD.currency,OLD.create_date,OLD.expires_at,OLD.request_parameters,OLD.created_at) THEN
    RAISE EXCEPTION 'Payment initiation is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_attempts_preserve_initiation BEFORE UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION payment_attempts_preserve_initiation();

CREATE FUNCTION payment_verifications_preserve_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Payment evidence cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.id,NEW.attempt_id,NEW.source,NEW.request_id,NEW.query_create_date,NEW.received_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.attempt_id,OLD.source,OLD.request_id,OLD.query_create_date,OLD.received_at) THEN
    RAISE EXCEPTION 'Payment evidence identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state='REQUESTED' AND NEW.state IN ('VERIFIED','UNRESOLVED') THEN RETURN NEW; END IF;
  IF ROW(NEW.state,NEW.payload,NEW.payload_hash,NEW.verified_at,NEW.error_code)
    IS DISTINCT FROM ROW(OLD.state,OLD.payload,OLD.payload_hash,OLD.verified_at,OLD.error_code)
    OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
    RAISE EXCEPTION 'Verified payment evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_verifications_preserve_evidence BEFORE UPDATE OR DELETE ON payment_verifications
  FOR EACH ROW EXECUTE FUNCTION payment_verifications_preserve_evidence();
COMMIT;
