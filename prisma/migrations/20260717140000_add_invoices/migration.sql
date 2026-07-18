-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "owner_user_id" TEXT NOT NULL,
    "title" TEXT,
    "amount" INTEGER,
    "payment_status" TEXT NOT NULL DEFAULT 'pending',
    "file_url" TEXT,
    "uploaded_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "building_id" TEXT,
    "vehicle_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_invoices_owner" ON "invoices"("owner_user_id");
