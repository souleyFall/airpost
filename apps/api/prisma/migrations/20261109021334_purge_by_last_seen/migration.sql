-- DropIndex
DROP INDEX "Offer_firstSeenAt_idx";

-- CreateIndex
CREATE INDEX "Offer_lastSeenAt_idx" ON "Offer"("lastSeenAt");
