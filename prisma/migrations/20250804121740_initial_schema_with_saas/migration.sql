-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "SaasPlan" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SaasPlanStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELED', 'TRIAL');

-- CreateEnum
CREATE TYPE "PrestationType" AS ENUM ('TATTOO', 'PIERCING', 'RETOUCHE', 'PROJET');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'SUBMITTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "password" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "salonName" TEXT,
    "image" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "postalCode" TEXT,
    "instagram" TEXT,
    "website" TEXT,
    "facebook" TEXT,
    "tiktok" TEXT,
    "description" TEXT,
    "salonHours" TEXT,
    "salonPhotos" TEXT[],
    "saasPlan" "SaasPlan" NOT NULL DEFAULT 'FREE',
    "saasPlanUntil" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tatoueur" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hours" TEXT,
    "userId" TEXT NOT NULL,
    "img" TEXT,
    "description" TEXT,
    "phone" TEXT,
    "instagram" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tatoueur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prestation" "PrestationType" NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "isPayed" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "tatoueurId" TEXT,
    "clientId" TEXT,
    "tattooDetailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "birthDate" TIMESTAMP(3),
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TattooDetail" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "appointmentId" TEXT,
    "description" TEXT NOT NULL,
    "zone" TEXT,
    "size" TEXT,
    "colorStyle" TEXT,
    "reference" TEXT,
    "sketch" TEXT,
    "estimatedPrice" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "isPayed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TattooDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allergies" TEXT,
    "healthIssues" TEXT,
    "medications" TEXT,
    "pregnancy" BOOLEAN NOT NULL,
    "tattooHistory" TEXT,

    CONSTRAINT "MedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TattooHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "beforeImage" TEXT,
    "afterImage" TEXT,
    "inkUsed" TEXT,
    "healingTime" TEXT,
    "careProducts" TEXT,

    CONSTRAINT "TattooHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aftercare" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "photoUrl" TEXT,
    "comment" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "visibleInPortfolio" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Aftercare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tatoueurId" TEXT,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSalon" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductSalon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpRequest" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submissionId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "FollowUpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSubmission" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "clientId" TEXT,
    "rating" INTEGER NOT NULL,
    "review" TEXT,
    "photoUrl" TEXT NOT NULL,
    "isAnswered" BOOLEAN NOT NULL DEFAULT false,
    "response" TEXT,
    "isPhotoPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "FollowUpSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaasPlanDetails" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currentPlan" "SaasPlan" NOT NULL DEFAULT 'FREE',
    "planStatus" "SaasPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialEndDate" TIMESTAMP(3),
    "maxAppointments" INTEGER NOT NULL DEFAULT 50,
    "maxClients" INTEGER NOT NULL DEFAULT 100,
    "maxTattooeurs" INTEGER NOT NULL DEFAULT 2,
    "maxPortfolioImages" INTEGER NOT NULL DEFAULT 10,
    "hasAdvancedStats" BOOLEAN NOT NULL DEFAULT false,
    "hasEmailReminders" BOOLEAN NOT NULL DEFAULT false,
    "hasCustomBranding" BOOLEAN NOT NULL DEFAULT false,
    "hasApiAccess" BOOLEAN NOT NULL DEFAULT false,
    "monthlyPrice" DOUBLE PRECISION,
    "yearlyPrice" DOUBLE PRECISION,
    "lastPaymentDate" TIMESTAMP(3),
    "nextPaymentDate" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPlanDetails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_email_token_key" ON "VerificationToken"("email", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON "PasswordResetToken"("email", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_email_key" ON "Client"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "TattooDetail_clientId_key" ON "TattooDetail"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TattooDetail_appointmentId_key" ON "TattooDetail"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TattooDetail_clientId_appointmentId_key" ON "TattooDetail"("clientId", "appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalHistory_clientId_key" ON "MedicalHistory"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpRequest_appointmentId_key" ON "FollowUpRequest"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpRequest_token_key" ON "FollowUpRequest"("token");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpRequest_submissionId_key" ON "FollowUpRequest"("submissionId");

-- CreateIndex
CREATE INDEX "FollowUpRequest_status_idx" ON "FollowUpRequest"("status");

-- CreateIndex
CREATE INDEX "FollowUpRequest_createdAt_idx" ON "FollowUpRequest"("createdAt");

-- CreateIndex
CREATE INDEX "FollowUpRequest_userId_idx" ON "FollowUpRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSubmission_appointmentId_key" ON "FollowUpSubmission"("appointmentId");

-- CreateIndex
CREATE INDEX "FollowUpSubmission_createdAt_idx" ON "FollowUpSubmission"("createdAt");

-- CreateIndex
CREATE INDEX "FollowUpSubmission_userId_idx" ON "FollowUpSubmission"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SaasPlanDetails_userId_key" ON "SaasPlanDetails"("userId");

-- CreateIndex
CREATE INDEX "SaasPlanDetails_currentPlan_idx" ON "SaasPlanDetails"("currentPlan");

-- CreateIndex
CREATE INDEX "SaasPlanDetails_planStatus_idx" ON "SaasPlanDetails"("planStatus");

-- CreateIndex
CREATE INDEX "SaasPlanDetails_endDate_idx" ON "SaasPlanDetails"("endDate");

-- AddForeignKey
ALTER TABLE "Tatoueur" ADD CONSTRAINT "Tatoueur_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooDetail" ADD CONSTRAINT "TattooDetail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooDetail" ADD CONSTRAINT "TattooDetail_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooHistory" ADD CONSTRAINT "TattooHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aftercare" ADD CONSTRAINT "Aftercare_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSalon" ADD CONSTRAINT "ProductSalon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRequest" ADD CONSTRAINT "FollowUpRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRequest" ADD CONSTRAINT "FollowUpRequest_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FollowUpSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpRequest" ADD CONSTRAINT "FollowUpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSubmission" ADD CONSTRAINT "FollowUpSubmission_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSubmission" ADD CONSTRAINT "FollowUpSubmission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSubmission" ADD CONSTRAINT "FollowUpSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaasPlanDetails" ADD CONSTRAINT "SaasPlanDetails_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
