-- DropForeignKey
ALTER TABLE "activation_codes" DROP CONSTRAINT "activation_codes_used_user_id_fkey";

-- DropForeignKey
ALTER TABLE "activation_codes" DROP CONSTRAINT "activation_codes_used_vehicle_id_fkey";

-- DropForeignKey
ALTER TABLE "buildings" DROP CONSTRAINT "fk_buildings_location";

-- DropForeignKey
ALTER TABLE "doors" DROP CONSTRAINT "doors_building_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "fk_subs_location";

-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicle_orders" ALTER COLUMN "refunded_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "cancelled_at" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "call_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "building_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_codes_code_key" ON "call_codes"("code");

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doors" ADD CONSTRAINT "doors_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_used_vehicle_id_fkey" FOREIGN KEY ("used_vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_used_user_id_fkey" FOREIGN KEY ("used_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

