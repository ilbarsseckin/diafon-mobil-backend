/*
  Warnings:

  - A unique constraint covering the columns `[qr_token]` on the table `buildings` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "buildings" ADD COLUMN     "qr_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "buildings_qr_token_key" ON "buildings"("qr_token");
