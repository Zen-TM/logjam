-- CreateTable
CREATE TABLE "shares" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "shared_by_id" TEXT NOT NULL,
    "shared_with_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_sends" (
    "id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "file_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_send_recipients" (
    "id" TEXT NOT NULL,
    "file_send_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "file_send_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shares_shared_with_id_entity_type_idx" ON "shares"("shared_with_id", "entity_type");

-- CreateIndex
CREATE INDEX "shares_entity_type_entity_id_idx" ON "shares"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "shares_entity_type_entity_id_shared_with_id_key" ON "shares"("entity_type", "entity_id", "shared_with_id");

-- CreateIndex
CREATE INDEX "file_sends_sender_id_idx" ON "file_sends"("sender_id");

-- CreateIndex
CREATE INDEX "file_sends_expires_at_idx" ON "file_sends"("expires_at");

-- CreateIndex
CREATE INDEX "file_send_recipients_user_id_status_idx" ON "file_send_recipients"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "file_send_recipients_file_send_id_user_id_key" ON "file_send_recipients"("file_send_id", "user_id");

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_shared_by_id_fkey" FOREIGN KEY ("shared_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shares" ADD CONSTRAINT "shares_shared_with_id_fkey" FOREIGN KEY ("shared_with_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_sends" ADD CONSTRAINT "file_sends_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_send_recipients" ADD CONSTRAINT "file_send_recipients_file_send_id_fkey" FOREIGN KEY ("file_send_id") REFERENCES "file_sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_send_recipients" ADD CONSTRAINT "file_send_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
