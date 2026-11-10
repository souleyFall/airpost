-- Santé de chaque connexion externe (sources d'offres, Gemini) : une ligne par connexion, mise à jour par les collectes.
CREATE TYPE "HealthStatus" AS ENUM ('OK', 'QUOTA', 'AUTH', 'DOWN', 'OFF');

CREATE TABLE "ApiHealth" (
    "key" TEXT NOT NULL,
    "status" "HealthStatus" NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),

    CONSTRAINT "ApiHealth_pkey" PRIMARY KEY ("key")
);
