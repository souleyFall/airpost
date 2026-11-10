-- Relance d'une candidature : une seule, avec son brouillon Gmail éventuel.
ALTER TABLE "Application" ADD COLUMN "followedUpAt" TIMESTAMP(3),
ADD COLUMN "followUpDraftId" TEXT;
