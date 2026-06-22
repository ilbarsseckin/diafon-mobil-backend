-- AlterTable
ALTER TABLE "buildings" ADD COLUMN     "location_check_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "location_check_radius" INTEGER NOT NULL DEFAULT 150;
