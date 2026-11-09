-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('LBA', 'LBB', 'ADZUNA');

-- CreateEnum
CREATE TYPE "ApplyChannel" AS ENUM ('EMAIL', 'SITE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('TO_REVIEW', 'VALIDATED', 'DRAFT_CREATED', 'APPLIED', 'ACKNOWLEDGED', 'INTERVIEW', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ReplyKind" AS ENUM ('ACKNOWLEDGEMENT', 'INTERVIEW', 'REJECTION', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "source" "OfferSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "city" TEXT,
    "postcode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "description" TEXT,
    "applyUrl" TEXT,
    "contactEmail" TEXT,
    "channel" "ApplyChannel" NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    "scoreDetail" JSONB,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'TO_REVIEW',
    "subject" TEXT,
    "body" TEXT,
    "gmailDraftId" TEXT,
    "validatedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reply" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "kind" "ReplyKind" NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "snippet" TEXT,

    CONSTRAINT "Reply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Offer_dedupKey_idx" ON "Offer"("dedupKey");

-- CreateIndex
CREATE INDEX "Offer_score_idx" ON "Offer"("score");

-- CreateIndex
CREATE INDEX "Offer_firstSeenAt_idx" ON "Offer"("firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_source_externalId_key" ON "Offer"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_offerId_key" ON "Application"("offerId");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_createdAt_idx" ON "Application"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reply_gmailMessageId_key" ON "Reply"("gmailMessageId");

-- CreateIndex
CREATE INDEX "Reply_applicationId_idx" ON "Reply"("applicationId");

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
