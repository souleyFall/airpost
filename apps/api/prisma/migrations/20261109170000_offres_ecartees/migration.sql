-- Offres écartées par l'IA : masquées du fil, conservées (sinon chaque collecte les réimporterait).
ALTER TABLE "Offer" ADD COLUMN "excluded" BOOLEAN NOT NULL DEFAULT false;

-- Reprise de l'existant : les analyses déjà faites qui concluent « hors cible ».
UPDATE "Offer" SET "excluded" = true WHERE "analysis" ->> 'verdict' = 'off_target';

CREATE INDEX "Offer_excluded_idx" ON "Offer"("excluded");