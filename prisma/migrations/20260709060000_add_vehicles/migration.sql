-- Vehicle (MobilDiafon Auto) tablosu ve subscription baglantisi
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "owner_user_id" TEXT NOT NULL,
  "label" TEXT,
  "plate" TEXT,
  "code" TEXT NOT NULL,
  "secret_code_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_code_key" ON "vehicles"("code");
CREATE INDEX IF NOT EXISTS "idx_vehicles_owner" ON "vehicles"("owner_user_id");

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "vehicle_id" TEXT;
CREATE INDEX IF NOT EXISTS "idx_subs_vehicle" ON "subscriptions"("vehicle_id");
