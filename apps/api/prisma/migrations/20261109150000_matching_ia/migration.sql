-- Le score n'est plus une grille de règles : il est calculé par le modèle de langage (voir src/matching).
-- Les anciens scores (grille) sont effacés : ils ne veulent plus rien dire et seront recalculés.

CREATE TYPE "ContractType" AS ENUM ('ALTERNANCE', 'STAGE', 'CDI', 'CDD', 'AUTRE');

ALTER TABLE "Offer" DROP COLUMN "scoreDetail";
UPDATE "Offer" SET "score" = NULL;

ALTER TABLE "Offer"
  ADD COLUMN "contractType" "ContractType" NOT NULL DEFAULT 'AUTRE',
  ADD COLUMN "distanceKm" DOUBLE PRECISION,
  ADD COLUMN "analysis" JSONB,
  ADD COLUMN "analyzedAt" TIMESTAMP(3),
  ADD COLUMN "profileHash" TEXT;

-- Filtres de la liste.
CREATE INDEX "Offer_source_idx" ON "Offer"("source");
CREATE INDEX "Offer_contractType_idx" ON "Offer"("contractType");
