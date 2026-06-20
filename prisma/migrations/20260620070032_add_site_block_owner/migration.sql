-- AlterTable
ALTER TABLE "buildings" ADD COLUMN     "block_name" TEXT,
ADD COLUMN     "owner_user_id" TEXT,
ADD COLUMN     "require_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "site_name" TEXT;
