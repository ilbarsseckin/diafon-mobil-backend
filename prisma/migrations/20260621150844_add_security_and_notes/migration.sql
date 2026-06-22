-- CreateTable
CREATE TABLE "security_guards" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "guard_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_guards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "apartment_id" TEXT NOT NULL,
    "from_user_id" TEXT,
    "from_role" TEXT NOT NULL,
    "from_name" TEXT,
    "text" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_guards_owner_user_id_phone_key" ON "security_guards"("owner_user_id", "phone");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "apartments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
