-- CreateTable
CREATE TABLE "vehicle_orders" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "buyer_name" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_email" TEXT,
    "ship_city" TEXT NOT NULL,
    "ship_district" TEXT,
    "ship_address" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "ship_status" TEXT NOT NULL DEFAULT 'preparing',
    "tracking_no" TEXT,
    "conversation_id" TEXT,
    "iyzico_payment_id" TEXT,
    "vehicle_code" TEXT,
    "vehicle_secret_code" TEXT,
    "buyer_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    CONSTRAINT "vehicle_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_vorders_status" ON "vehicle_orders"("status");
