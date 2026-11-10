-- Nouvelle source : Google Jobs (via SerpApi), et la plateforme d'origine des annonces qu'elle reprend.
-- Aucune reprise de données : la valeur d'énumération n'est pas utilisée dans cette migration.
ALTER TYPE "OfferSource" ADD VALUE 'GOOGLE_JOBS';

ALTER TABLE "Offer" ADD COLUMN "via" TEXT;
