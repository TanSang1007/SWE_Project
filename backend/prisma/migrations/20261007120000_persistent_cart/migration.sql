-- B08 additive migration. Initial migration is unchanged.
CREATE TABLE "carts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");
CREATE TABLE "cart_items" (
  "id" UUID NOT NULL,
  "cart_id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "size" TEXT NOT NULL,
  "configuration_key" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cart_items_qty_check" CHECK ("qty" BETWEEN 1 AND 99)
);
CREATE UNIQUE INDEX "cart_items_cart_id_configuration_key_key" ON "cart_items"("cart_id", "configuration_key");
CREATE INDEX "cart_items_product_id_size_idx" ON "cart_items"("product_id", "size");
CREATE TABLE "cart_item_toppings" (
  "cart_item_id" UUID NOT NULL,
  "topping_id" UUID NOT NULL,
  CONSTRAINT "cart_item_toppings_pkey" PRIMARY KEY ("cart_item_id", "topping_id")
);
CREATE INDEX "cart_item_toppings_topping_id_idx" ON "cart_item_toppings"("topping_id");
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_size_fkey" FOREIGN KEY ("product_id", "size") REFERENCES "product_sizes"("product_id", "size") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cart_item_toppings" ADD CONSTRAINT "cart_item_toppings_cart_item_id_fkey" FOREIGN KEY ("cart_item_id") REFERENCES "cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_item_toppings" ADD CONSTRAINT "cart_item_toppings_topping_id_fkey" FOREIGN KEY ("topping_id") REFERENCES "toppings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
