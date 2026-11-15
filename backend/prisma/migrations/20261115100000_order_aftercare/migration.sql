-- O01 additive aftercare. Existing financial/order/inventory rows are untouched.
CREATE TABLE order_tracking_events (
 id UUID PRIMARY KEY, sequence BIGSERIAL UNIQUE NOT NULL,
 order_id UUID NOT NULL, kind VARCHAR(24) NOT NULL CHECK(kind IN ('STATUS','SUPPORT','REFUND')),
 from_status VARCHAR(32), status VARCHAR(32) NOT NULL,
 actor_id UUID, actor_role VARCHAR(16) NOT NULL DEFAULT 'SYSTEM',
 note VARCHAR(500), occurred_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX order_tracking_events_order_sequence_idx ON order_tracking_events(order_id,sequence);
CREATE TABLE order_support_requests (
 id UUID PRIMARY KEY, order_id UUID NOT NULL, requested_by_id UUID NOT NULL,
 request_key UUID NOT NULL, reason VARCHAR(500) NOT NULL CHECK(length(trim(reason))>0),
 status VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','APPROVED','REJECTED')),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 reviewed_by_id UUID, review_note VARCHAR(500), reviewed_at TIMESTAMPTZ(6),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT order_support_request_idempotency_key UNIQUE(order_id,requested_by_id,request_key),
 CHECK((status='OPEN' AND reviewed_by_id IS NULL AND reviewed_at IS NULL) OR
       (status<>'OPEN' AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL))
);
CREATE TABLE order_refunds (
 id UUID PRIMARY KEY, order_id UUID NOT NULL UNIQUE, payment_id UUID NOT NULL UNIQUE,
 amount NUMERIC(12,0) NOT NULL CHECK(amount>0),
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCEEDED','FAILED')),
 reason VARCHAR(500) NOT NULL CHECK(length(trim(reason))>0),
 requested_by_id UUID NOT NULL, approved_by_id UUID, approved_at TIMESTAMPTZ(6),
 processed_by_id UUID, processed_at TIMESTAMPTZ(6),
 transaction_reference VARCHAR(128) UNIQUE, evidence_reference VARCHAR(500), failure_reason VARCHAR(500),
 version INTEGER NOT NULL DEFAULT 0 CHECK(version>=0),
 created_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
 CHECK((approved_by_id IS NULL)=(approved_at IS NULL)),
 CHECK((status='PENDING' AND processed_by_id IS NULL AND processed_at IS NULL AND transaction_reference IS NULL AND evidence_reference IS NULL AND failure_reason IS NULL) OR
       (status='SUCCEEDED' AND approved_by_id IS NOT NULL AND processed_by_id IS NOT NULL AND processed_at IS NOT NULL AND transaction_reference IS NOT NULL AND evidence_reference IS NOT NULL AND length(trim(transaction_reference))>0 AND length(trim(evidence_reference))>0 AND failure_reason IS NULL) OR
       (status='FAILED' AND approved_by_id IS NOT NULL AND processed_by_id IS NOT NULL AND processed_at IS NOT NULL AND failure_reason IS NOT NULL AND length(trim(failure_reason))>0 AND transaction_reference IS NULL AND evidence_reference IS NULL))
);
-- Development preserves historical TEXT identities; match only the new FKs.
DO $$
DECLARE entry RECORD; target_type TEXT;
BEGIN
 FOR entry IN SELECT * FROM (VALUES
  ('order_tracking_events','order_id','orders'),('order_support_requests','order_id','orders'),('order_refunds','order_id','orders'),
  ('order_refunds','payment_id','payments'),('order_tracking_events','actor_id','users'),
  ('order_support_requests','requested_by_id','users'),('order_support_requests','reviewed_by_id','users'),
  ('order_refunds','requested_by_id','users'),('order_refunds','approved_by_id','users'),('order_refunds','processed_by_id','users')
 ) AS fields(table_name,column_name,parent_table)
 LOOP
  SELECT format_type(a.atttypid,a.atttypmod) INTO target_type FROM pg_attribute a WHERE a.attrelid=to_regclass(entry.parent_table) AND a.attname='id';
  IF target_type IS NULL THEN RAISE EXCEPTION 'Missing aftercare foundation'; END IF;
  EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE %s USING %I::text::%s',entry.table_name,entry.column_name,target_type,entry.column_name,target_type);
  EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE RESTRICT',entry.table_name,entry.column_name,entry.parent_table);
 END LOOP;
END $$;
CREATE FUNCTION record_order_tracking_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status THEN
  INSERT INTO order_tracking_events(id,order_id,kind,from_status,status,actor_id,actor_role)
  SELECT gen_random_uuid(),NEW.id,'STATUS',CASE WHEN TG_OP='UPDATE' THEN OLD.status::text ELSE NULL END,NEW.status::text,
   u.id,COALESCE(u.role::text,'SYSTEM')
  FROM (SELECT 1) singleton LEFT JOIN users u ON u.id::text=nullif(current_setting('brewlite.actor_id',true),'');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_tracking_status AFTER INSERT OR UPDATE OF status ON orders FOR EACH ROW EXECUTE FUNCTION record_order_tracking_status();
CREATE FUNCTION protect_order_tracking_events() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Order tracking events are append-only'; END $$;
CREATE TRIGGER order_tracking_events_append_only BEFORE UPDATE OR DELETE ON order_tracking_events FOR EACH ROW EXECUTE FUNCTION protect_order_tracking_events();
CREATE FUNCTION protect_order_refunds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='SUCCEEDED' THEN RAISE EXCEPTION 'Refund history is immutable'; END IF;
 IF (NEW.order_id,NEW.payment_id,NEW.amount,NEW.requested_by_id,NEW.reason,NEW.created_at) IS DISTINCT FROM
    (OLD.order_id,OLD.payment_id,OLD.amount,OLD.requested_by_id,OLD.reason,OLD.created_at) THEN RAISE EXCEPTION 'Refund binding is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_refunds_immutable BEFORE UPDATE OR DELETE ON order_refunds FOR EACH ROW EXECUTE FUNCTION protect_order_refunds();
