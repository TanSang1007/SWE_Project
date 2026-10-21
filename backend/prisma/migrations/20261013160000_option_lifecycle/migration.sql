-- AD02/D41: additive option lifecycle and global Topping OCC; preserve legacy data.
ALTER TABLE "product_sizes" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "toppings" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "toppings" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "toppings" ADD CONSTRAINT "toppings_version_check" CHECK ("version" >= 0);
