-- CreateTable
CREATE TABLE "friend_invites" (
    "id" TEXT NOT NULL,
    "inviter_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "friend_invites_token_hash_key" ON "friend_invites"("token_hash");

-- CreateIndex
CREATE INDEX "friend_invites_inviter_id_idx" ON "friend_invites"("inviter_id");

-- AddForeignKey
ALTER TABLE "friend_invites" ADD CONSTRAINT "friend_invites_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

