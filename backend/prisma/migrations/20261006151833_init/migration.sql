-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'PAYMENT_FAILED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('WALLET', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IdempotencyOperation" AS ENUM ('CREATE_ORDER', 'PAY_ORDER');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('PROCESSING', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "loyalty_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,0) NOT NULL,
    "image_url" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_sizes" (
    "product_id" UUID NOT NULL,
    "size" TEXT NOT NULL,
    "extra_price" DECIMAL(12,0) NOT NULL,

    CONSTRAINT "product_sizes_pkey" PRIMARY KEY ("product_id","size")
);

-- CreateTable
CREATE TABLE "toppings" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,0) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toppings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_toppings" (
    "product_id" UUID NOT NULL,
    "topping_id" UUID NOT NULL,

    CONSTRAINT "product_toppings_pkey" PRIMARY KEY ("product_id","topping_id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_amount" DECIMAL(12,0) NOT NULL,
    "minimum_subtotal" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_code" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "subtotal" DECIMAL(12,0) NOT NULL,
    "discount_amount" DECIMAL(12,0) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,0) NOT NULL,
    "promotion_id" UUID,
    "promotion_code_snapshot" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "base_price" DECIMAL(12,0) NOT NULL,
    "size_extra_price" DECIMAL(12,0) NOT NULL,
    "unit_price" DECIMAL(12,0) NOT NULL,
    "qty" INTEGER NOT NULL,
    "line_total" DECIMAL(12,0) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_toppings" (
    "order_item_id" UUID NOT NULL,
    "topping_id" UUID NOT NULL,
    "topping_name_snapshot" TEXT NOT NULL,
    "price_snapshot" DECIMAL(12,0) NOT NULL,

    CONSTRAINT "order_item_toppings_pkey" PRIMARY KEY ("order_item_id","topping_id")
);

-- CreateTable
CREATE TABLE "idempotency_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "operation" "IdempotencyOperation" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" "IdempotencyState" NOT NULL,
    "order_id" UUID,
    "response_status" SMALLINT,
    "response_body" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "idempotency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "idempotency_request_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount" DECIMAL(12,0) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_awards" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(6),

    CONSTRAINT "loyalty_awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "product_toppings_topping_id_idx" ON "product_toppings"("topping_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_code_key" ON "orders"("order_code");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_id_idx" ON "orders"("user_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_item_toppings_topping_id_idx" ON "order_item_toppings"("topping_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_requests_user_id_operation_idempotency_key_key" ON "idempotency_requests"("user_id", "operation", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_request_id_key" ON "payments"("idempotency_request_id");

-- CreateIndex
CREATE INDEX "payments_order_id_created_at_idx" ON "payments"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_user_id_idempotency_key_key" ON "payments"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_awards_order_id_key" ON "loyalty_awards"("order_id");

-- CreateIndex
CREATE INDEX "loyalty_awards_user_id_idx" ON "loyalty_awards"("user_id");

-- AddForeignKey
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_toppings" ADD CONSTRAINT "product_toppings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_toppings" ADD CONSTRAINT "product_toppings_topping_id_fkey" FOREIGN KEY ("topping_id") REFERENCES "toppings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_toppings" ADD CONSTRAINT "order_item_toppings_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_toppings" ADD CONSTRAINT "order_item_toppings_topping_id_fkey" FOREIGN KEY ("topping_id") REFERENCES "toppings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_idempotency_request_id_fkey" FOREIGN KEY ("idempotency_request_id") REFERENCES "idempotency_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_awards" ADD CONSTRAINT "loyalty_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SQL-only invariants from Docs/DATABASE_DESIGN.md sections 3-4.
ALTER TABLE "users" ADD CONSTRAINT "users_loyalty_points_check" CHECK (loyalty_points >= 0);
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_check" CHECK (price >= 0),
  ADD CONSTRAINT "products_stock_check" CHECK (stock >= 0),
  ADD CONSTRAINT "products_version_check" CHECK (version >= 0);
ALTER TABLE "product_sizes"
  ADD CONSTRAINT "product_sizes_size_check" CHECK (size IN ('S','M','L')),
  ADD CONSTRAINT "product_sizes_extra_price_check" CHECK (extra_price >= 0);
ALTER TABLE "toppings" ADD CONSTRAINT "toppings_price_check" CHECK (price >= 0);
ALTER TABLE "promotions"
  ADD CONSTRAINT "promotions_discount_amount_check" CHECK (discount_amount > 0),
  ADD CONSTRAINT "promotions_minimum_subtotal_check" CHECK (minimum_subtotal >= 0),
  ADD CONSTRAINT "promotions_dates_check" CHECK (ends_at > starts_at);
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_subtotal_check" CHECK (subtotal >= 0),
  ADD CONSTRAINT "orders_discount_amount_check" CHECK (discount_amount >= 0 AND discount_amount <= subtotal),
  ADD CONSTRAINT "orders_total_check" CHECK (total >= 0 AND total = subtotal - discount_amount),
  ADD CONSTRAINT "orders_version_check" CHECK (version >= 0),
  ADD CONSTRAINT "orders_promotion_snapshot_check" CHECK ((promotion_id IS NULL) = (promotion_code_snapshot IS NULL)),
  ADD CONSTRAINT "orders_no_promotion_discount_check" CHECK (promotion_id IS NOT NULL OR discount_amount = 0);
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_size_check" CHECK (size IN ('S','M','L')),
  ADD CONSTRAINT "order_items_base_price_check" CHECK (base_price >= 0),
  ADD CONSTRAINT "order_items_size_extra_price_check" CHECK (size_extra_price >= 0),
  ADD CONSTRAINT "order_items_unit_price_check" CHECK (unit_price >= 0),
  ADD CONSTRAINT "order_items_qty_check" CHECK (qty BETWEEN 1 AND 99),
  ADD CONSTRAINT "order_items_line_total_check" CHECK (line_total >= 0 AND line_total = unit_price * qty);
ALTER TABLE "order_item_toppings" ADD CONSTRAINT "order_item_toppings_price_check" CHECK (price_snapshot >= 0);
ALTER TABLE "idempotency_requests"
  ADD CONSTRAINT "idempotency_response_status_check" CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  ADD CONSTRAINT "idempotency_result_check" CHECK (
    (state = 'PROCESSING' AND order_id IS NULL AND response_status IS NULL AND response_body IS NULL AND completed_at IS NULL)
    OR (state = 'COMPLETED' AND order_id IS NOT NULL AND response_status IS NOT NULL AND response_body IS NOT NULL AND completed_at IS NOT NULL)
  );
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK (amount >= 0),
  ADD CONSTRAINT "payments_failure_code_check" CHECK (
    (status = 'SUCCEEDED' AND failure_code IS NULL)
    OR (status = 'FAILED' AND failure_code IS NOT NULL AND length(btrim(failure_code)) > 0)
  );
CREATE UNIQUE INDEX "payments_one_success_per_order_idx" ON "payments" (order_id) WHERE status = 'SUCCEEDED';
ALTER TABLE "loyalty_awards"
  ADD CONSTRAINT "loyalty_awards_points_check" CHECK (points >= 0),
  ADD CONSTRAINT "loyalty_awards_reversed_at_check" CHECK (reversed_at IS NULL OR reversed_at >= created_at);
