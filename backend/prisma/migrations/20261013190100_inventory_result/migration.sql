BEGIN;
-- Preserve PROCESSING, all completion fields and the existing Order requirement
-- for CREATE_ORDER/PAY_ORDER. Inventory results do not create an Order.
ALTER TABLE "idempotency_requests" DROP CONSTRAINT "idempotency_result_check";
ALTER TABLE "idempotency_requests"
  ADD CONSTRAINT "idempotency_result_check" CHECK (
    (state = 'PROCESSING' AND order_id IS NULL AND response_status IS NULL
      AND response_body IS NULL AND completed_at IS NULL)
    OR (state = 'COMPLETED' AND response_status IS NOT NULL
      AND response_body IS NOT NULL AND completed_at IS NOT NULL
      AND ((operation IN ('CREATE_ORDER', 'PAY_ORDER') AND order_id IS NOT NULL)
        OR (operation = 'ADJUST_INVENTORY' AND order_id IS NULL)))
  );
COMMIT;
