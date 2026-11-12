-- The one foreign key without an index of its own (queryPlans.test.ts).

-- CreateIndex
CREATE INDEX "shares_shared_by_id_idx" ON "shares"("shared_by_id");
