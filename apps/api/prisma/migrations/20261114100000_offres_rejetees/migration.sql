-- Offres rejetées par l'utilisateur : restaurables 7 jours, puis contenu vidé.
ALTER TABLE "Offer" ADD COLUMN "rejectedAt" TIMESTAMP(3);

CREATE INDEX "Offer_rejectedAt_idx" ON "Offer"("rejectedAt");
