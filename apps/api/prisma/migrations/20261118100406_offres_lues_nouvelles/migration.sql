-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- Les offres déjà en base sont considérées comme lues : seules les prochaines apparaîtront en surbrillance.
UPDATE "Offer" SET "viewedAt" = CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CollectionRun" (
    "id" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionRun_startedAt_idx" ON "CollectionRun"("startedAt");

-- CreateIndex
CREATE INDEX "Offer_viewedAt_idx" ON "Offer"("viewedAt");
