-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'user', 'user_salon', 'user_tatoueur', 'client', 'formateur');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'SYSTEM', 'IMAGE', 'FILE');

-- CreateEnum
CREATE TYPE "SaasPlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AgendaMode" AS ENUM ('GLOBAL', 'PAR_TATOUEUR');

-- CreateEnum
CREATE TYPE "SaasPlanStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED', 'TRIAL');

-- CreateEnum
CREATE TYPE "SalonVerificationDocumentType" AS ENUM ('HYGIENE_SALUBRITE', 'ARS_DECLARATION', 'LEGAL_PROOF');

-- CreateEnum
CREATE TYPE "VerificationStatusDocument" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TeamRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REFUSED');

-- CreateEnum
CREATE TYPE "PrestationType" AS ENUM ('TATTOO', 'PIERCING', 'RETOUCHE', 'PROJET');

-- CreateEnum
CREATE TYPE "PiercingZone" AS ENUM ('OREILLE', 'VISAGE', 'BOUCHE', 'CORPS', 'MICRODERMAL');

-- CreateEnum
CREATE TYPE "PiercingZoneOreille" AS ENUM ('LOBE', 'LOBE_x2', 'HELIX', 'ANTI_HELIX', 'ROOK', 'TRAGUS', 'ANTI_TRAGUS', 'CONCH', 'FLAT', 'DAITH', 'SNUG', 'INDUSTRIEL', 'STRETCH', 'SURFACE_TRAGUS', 'CARTILAGE_PUNCH');

-- CreateEnum
CREATE TYPE "PiercingZoneVisage" AS ENUM ('NOSTRIL_FAKE_RING', 'NOSTRIL_FAKE_RING_x2', 'NOSTRIL_CLASSIQUE', 'NOSTRIL_CLASSIQUE_x2', 'HIGH_NOSTRIL', 'HIGH_NOSTRIL_x2', 'SEPTUM', 'ARCADE', 'CHEEK', 'CHEEK_x2', 'BRIDGE');

-- CreateEnum
CREATE TYPE "PiercingZoneBouche" AS ENUM ('SMILEY', 'MEDUSA', 'LABRET', 'JESTRUM', 'LABRET_VERTICAL', 'LABRET_DECALE', 'DAHLIA', 'LANGUE', 'LANGUE_VENUM', 'ANGEL_BITES', 'SNAKE_BITES', 'ANGEL_FANGS', 'CYBER_BITES', 'ASHLEY');

-- CreateEnum
CREATE TYPE "PiercingZoneCorps" AS ENUM ('NOMBRIL', 'TETON', 'TETON_x2');

-- CreateEnum
CREATE TYPE "PiercingZoneMicrodermal" AS ENUM ('SURFACE', 'MICRODERMAL');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'CANCELED', 'RESCHEDULING', 'NO_SHOW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DrawingCardStatus" AS ENUM ('A_DESSINER', 'EN_COURS', 'A_MODIFIER', 'TERMINE', 'APPROUVE');

-- CreateEnum
CREATE TYPE "DrawingCardNoteType" AS ENUM ('INTERNAL', 'CLIENT_EXCHANGE', 'DESIGN_UPDATE');

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
    "profileImage" TEXT,
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
    "isInspirationSalon" BOOLEAN NOT NULL DEFAULT true,
    "saasPlan" "SaasPlan" NOT NULL DEFAULT 'FREE',
    "saasPlanUntil" TIMESTAMP(3),
    "role" "Role" NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "prestations" TEXT[],
    "style" TEXT[],
    "verifiedSalon" BOOLEAN NOT NULL DEFAULT false,
    "addConfirmationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "appointmentBookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "projectAppointmentDurationMinutes" INTEGER DEFAULT 60,
    "projectAppointmentIsFree" BOOLEAN NOT NULL DEFAULT true,
    "projectAppointmentPrice" DOUBLE PRECISION,
    "followUpEmailDelayDays" INTEGER NOT NULL DEFAULT 7,
    "retouchEmailDelayDays" INTEGER NOT NULL DEFAULT 30,
    "salonCanViewAppointments" BOOLEAN NOT NULL DEFAULT true,
    "salonCanCreateAppointments" BOOLEAN NOT NULL DEFAULT true,
    "colorProfile" TEXT DEFAULT 'default',
    "colorProfileBis" TEXT DEFAULT 'default',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "salonId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pseudo" TEXT,
    "birthDate" TIMESTAMP(3),
    "city" TEXT,
    "postalCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Moodboard" (
    "id" TEXT NOT NULL,
    "clientProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Moodboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoodboardImage" (
    "id" TEXT NOT NULL,
    "moodboardId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoodboardImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteUser" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonReview" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "photos" TEXT[],
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "salonResponse" TEXT,
    "salonRespondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonProfileView" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "viewerIpHash" TEXT,
    "referrer" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "city" TEXT,
    "deviceType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalonProfileView_pkey" PRIMARY KEY ("id")
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
    "skills" TEXT[],
    "style" TEXT[],
    "rdvBookingEnabled" BOOLEAN NOT NULL DEFAULT true,

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
    "performerUserId" TEXT,
    "clientId" TEXT,
    "clientUserId" TEXT,
    "skin" TEXT,
    "tattooDetailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "visio" BOOLEAN NOT NULL DEFAULT false,
    "visioRoom" TEXT,
    "followUp7SentAt" TIMESTAMP(3),
    "followUp30SentAt" TIMESTAMP(3),
    "moodboardId" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingCard" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "sourceAppointmentId" TEXT NOT NULL,
    "tattooAppointmentId" TEXT,
    "clientId" TEXT,
    "clientUserId" TEXT,
    "tatoueurId" TEXT,
    "performerUserId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "additionalInfo" TEXT,
    "status" "DrawingCardStatus" NOT NULL DEFAULT 'A_DESSINER',
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingCardNote" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "DrawingCardNoteType" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrawingCardNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawingCardImage" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingCardImage_pkey" PRIMARY KEY ("id")
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
    "piercingZone" "PiercingZone",
    "piercingServicePriceId" TEXT,
    "estimatedPrice" DOUBLE PRECISION,
    "price" DOUBLE PRECISION,
    "isPayed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TattooDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiercingPrice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "piercingZone" "PiercingZone" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PiercingPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiercingServicePrice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "piercingPriceId" TEXT NOT NULL,
    "piercingZoneOreille" "PiercingZoneOreille",
    "piercingZoneVisage" "PiercingZoneVisage",
    "piercingZoneBouche" "PiercingZoneBouche",
    "piercingZoneCorps" "PiercingZoneCorps",
    "piercingZoneMicrodermal" "PiercingZoneMicrodermal",
    "price" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PiercingServicePrice_pkey" PRIMARY KEY ("id")
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
    "consentSigned" BOOLEAN NOT NULL DEFAULT false,
    "consentSignedAt" TIMESTAMP(3),
    "consentFileUrl" TEXT,
    "isMinor" BOOLEAN NOT NULL DEFAULT false,
    "guardianName" TEXT,
    "guardianPhone" TEXT,
    "tags" TEXT[],
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "linkedUserId" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "allergies" TEXT,
    "healthIssues" TEXT,
    "medications" TEXT,
    "pregnancy" BOOLEAN NOT NULL,
    "previousReactions" TEXT,
    "tattooHistory" TEXT,

    CONSTRAINT "MedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TattooHistory" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "inkUsed" TEXT,
    "healingTime" TEXT,
    "careProducts" TEXT,
    "photo" TEXT,
    "price" DOUBLE PRECISION,
    "size" TEXT,
    "tatoueurId" TEXT,
    "zone" TEXT,

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
CREATE TABLE "BlockedTimeSlot" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "tatoueurId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockedTimeSlot_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "style" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tatoueurId" TEXT,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoritePortfolio" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoritePortfolio_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Flash" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tatoueurId" TEXT,
    "title" TEXT NOT NULL,
    "style" TEXT[],
    "dimension" TEXT,
    "appointmentDurationMinutes" INTEGER NOT NULL DEFAULT 60,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "author" TEXT,
    "imageUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "type" TEXT,
    "brand" TEXT,
    "reference" TEXT,
    "pigment" TEXT,
    "lotNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "notes" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "minQuantity" INTEGER,
    "pricePerUnit" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentConsumable" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stockItemId" TEXT,
    "category" TEXT,
    "productName" TEXT,
    "brand" TEXT,
    "reference" TEXT,
    "pigment" TEXT,
    "lotNumber" TEXT,
    "expirationDate" TIMESTAMP(3),
    "quantity" DOUBLE PRECISION,
    "unit" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentConsumable_pkey" PRIMARY KEY ("id")
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
    "agendaMode" "AgendaMode" NOT NULL DEFAULT 'PAR_TATOUEUR',
    "planStatus" "SaasPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "trialEndDate" TIMESTAMP(3),
    "maxAppointments" INTEGER NOT NULL DEFAULT 30,
    "maxClients" INTEGER NOT NULL DEFAULT 50,
    "maxTattooeurs" INTEGER NOT NULL DEFAULT 1,
    "maxPortfolioImages" INTEGER NOT NULL DEFAULT 5,
    "hasAdvancedStats" BOOLEAN NOT NULL DEFAULT false,
    "hasEmailReminders" BOOLEAN NOT NULL DEFAULT false,
    "hasCustomBranding" BOOLEAN NOT NULL DEFAULT false,
    "hasApiAccess" BOOLEAN NOT NULL DEFAULT false,
    "monthlyPrice" DOUBLE PRECISION,
    "yearlyPrice" DOUBLE PRECISION,
    "lastPaymentDate" TIMESTAMP(3),
    "nextPaymentDate" TIMESTAMP(3),
    "pastDueSince" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "stripeCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SaasPlanDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonVerificationDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SalonVerificationDocumentType" NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "VerificationStatusDocument" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "SalonVerificationDocument_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'TEXT',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadThingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageNotification" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastUnreadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailFrequency" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "mutedConversations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailNotificationQueue" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailNotificationQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalonTatoueurTeamRequest" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "tatoueurUserId" TEXT NOT NULL,
    "message" TEXT,
    "status" "TeamRequestStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonTatoueurTeamRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProfile_userId_key" ON "ClientProfile"("userId");

-- CreateIndex
CREATE INDEX "Moodboard_clientProfileId_idx" ON "Moodboard"("clientProfileId");

-- CreateIndex
CREATE INDEX "MoodboardImage_moodboardId_idx" ON "MoodboardImage"("moodboardId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteUser_clientId_salonId_key" ON "FavoriteUser"("clientId", "salonId");

-- CreateIndex
CREATE UNIQUE INDEX "SalonReview_appointmentId_key" ON "SalonReview"("appointmentId");

-- CreateIndex
CREATE INDEX "SalonReview_salonId_idx" ON "SalonReview"("salonId");

-- CreateIndex
CREATE INDEX "SalonReview_authorId_idx" ON "SalonReview"("authorId");

-- CreateIndex
CREATE INDEX "SalonReview_rating_idx" ON "SalonReview"("rating");

-- CreateIndex
CREATE INDEX "SalonReview_createdAt_idx" ON "SalonReview"("createdAt");

-- CreateIndex
CREATE INDEX "SalonReview_isVisible_idx" ON "SalonReview"("isVisible");

-- CreateIndex
CREATE INDEX "SalonProfileView_salonId_createdAt_idx" ON "SalonProfileView"("salonId", "createdAt");

-- CreateIndex
CREATE INDEX "SalonProfileView_createdAt_idx" ON "SalonProfileView"("createdAt");

-- CreateIndex
CREATE INDEX "SalonProfileView_deviceType_idx" ON "SalonProfileView"("deviceType");

-- CreateIndex
CREATE INDEX "Appointment_userId_idx" ON "Appointment"("userId");

-- CreateIndex
CREATE INDEX "Appointment_performerUserId_idx" ON "Appointment"("performerUserId");

-- CreateIndex
CREATE INDEX "Appointment_clientUserId_idx" ON "Appointment"("clientUserId");

-- CreateIndex
CREATE INDEX "Appointment_status_idx" ON "Appointment"("status");

-- CreateIndex
CREATE INDEX "Appointment_start_idx" ON "Appointment"("start");

-- CreateIndex
CREATE INDEX "Appointment_followUp7SentAt_idx" ON "Appointment"("followUp7SentAt");

-- CreateIndex
CREATE INDEX "Appointment_followUp30SentAt_idx" ON "Appointment"("followUp30SentAt");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingCard_sourceAppointmentId_key" ON "DrawingCard"("sourceAppointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DrawingCard_tattooAppointmentId_key" ON "DrawingCard"("tattooAppointmentId");

-- CreateIndex
CREATE INDEX "DrawingCard_salonId_status_idx" ON "DrawingCard"("salonId", "status");

-- CreateIndex
CREATE INDEX "DrawingCard_clientId_idx" ON "DrawingCard"("clientId");

-- CreateIndex
CREATE INDEX "DrawingCard_clientUserId_idx" ON "DrawingCard"("clientUserId");

-- CreateIndex
CREATE INDEX "DrawingCard_performerUserId_idx" ON "DrawingCard"("performerUserId");

-- CreateIndex
CREATE INDEX "DrawingCardNote_cardId_createdAt_idx" ON "DrawingCardNote"("cardId", "createdAt");

-- CreateIndex
CREATE INDEX "DrawingCardImage_cardId_createdAt_idx" ON "DrawingCardImage"("cardId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TattooDetail_appointmentId_key" ON "TattooDetail"("appointmentId");

-- CreateIndex
CREATE INDEX "PiercingPrice_userId_idx" ON "PiercingPrice"("userId");

-- CreateIndex
CREATE INDEX "PiercingPrice_piercingZone_idx" ON "PiercingPrice"("piercingZone");

-- CreateIndex
CREATE UNIQUE INDEX "PiercingPrice_userId_piercingZone_key" ON "PiercingPrice"("userId", "piercingZone");

-- CreateIndex
CREATE INDEX "PiercingServicePrice_userId_idx" ON "PiercingServicePrice"("userId");

-- CreateIndex
CREATE INDEX "PiercingServicePrice_piercingPriceId_idx" ON "PiercingServicePrice"("piercingPriceId");

-- CreateIndex
CREATE UNIQUE INDEX "PiercingServicePrice_piercingPriceId_piercingZoneOreille_pi_key" ON "PiercingServicePrice"("piercingPriceId", "piercingZoneOreille", "piercingZoneVisage", "piercingZoneBouche", "piercingZoneCorps", "piercingZoneMicrodermal");

-- CreateIndex
CREATE INDEX "Client_linkedUserId_idx" ON "Client"("linkedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Client_userId_email_key" ON "Client"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalHistory_clientId_key" ON "MedicalHistory"("clientId");

-- CreateIndex
CREATE INDEX "BlockedTimeSlot_startDate_endDate_idx" ON "BlockedTimeSlot"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "BlockedTimeSlot_tatoueurId_idx" ON "BlockedTimeSlot"("tatoueurId");

-- CreateIndex
CREATE INDEX "BlockedTimeSlot_userId_idx" ON "BlockedTimeSlot"("userId");

-- CreateIndex
CREATE INDEX "FavoritePortfolio_clientId_idx" ON "FavoritePortfolio"("clientId");

-- CreateIndex
CREATE INDEX "FavoritePortfolio_portfolioId_idx" ON "FavoritePortfolio"("portfolioId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoritePortfolio_clientId_portfolioId_key" ON "FavoritePortfolio"("clientId", "portfolioId");

-- CreateIndex
CREATE INDEX "Flash_userId_idx" ON "Flash"("userId");

-- CreateIndex
CREATE INDEX "Flash_tatoueurId_idx" ON "Flash"("tatoueurId");

-- CreateIndex
CREATE INDEX "Flash_isAvailable_idx" ON "Flash"("isAvailable");

-- CreateIndex
CREATE INDEX "Article_createdAt_idx" ON "Article"("createdAt");

-- CreateIndex
CREATE INDEX "StockItem_userId_lotNumber_idx" ON "StockItem"("userId", "lotNumber");

-- CreateIndex
CREATE INDEX "StockItem_reference_idx" ON "StockItem"("reference");

-- CreateIndex
CREATE INDEX "StockItem_expirationDate_idx" ON "StockItem"("expirationDate");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_appointmentId_idx" ON "AppointmentConsumable"("appointmentId");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_userId_lotNumber_idx" ON "AppointmentConsumable"("userId", "lotNumber");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_lotNumber_idx" ON "AppointmentConsumable"("lotNumber");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_reference_idx" ON "AppointmentConsumable"("reference");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_expirationDate_idx" ON "AppointmentConsumable"("expirationDate");

-- CreateIndex
CREATE INDEX "AppointmentConsumable_category_idx" ON "AppointmentConsumable"("category");

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

-- CreateIndex
CREATE INDEX "SaasPlanDetails_pastDueSince_idx" ON "SaasPlanDetails"("pastDueSince");

-- CreateIndex
CREATE UNIQUE INDEX "StripeWebhookEvent_eventId_key" ON "StripeWebhookEvent"("eventId");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_eventType_idx" ON "StripeWebhookEvent"("eventType");

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_createdAt_idx" ON "StripeWebhookEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SalonVerificationDocument_userId_idx" ON "SalonVerificationDocument"("userId");

-- CreateIndex
CREATE INDEX "SalonVerificationDocument_status_idx" ON "SalonVerificationDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SalonVerificationDocument_userId_type_key" ON "SalonVerificationDocument"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_email_token_key" ON "VerificationToken"("email", "token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_email_token_key" ON "PasswordResetToken"("email", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_appointmentId_key" ON "Conversation"("appointmentId");

-- CreateIndex
CREATE INDEX "Conversation_salonId_lastMessageAt_idx" ON "Conversation"("salonId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_clientUserId_lastMessageAt_idx" ON "Conversation"("clientUserId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_appointmentId_idx" ON "Conversation"("appointmentId");

-- CreateIndex
CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_salonId_clientUserId_appointmentId_key" ON "Conversation"("salonId", "clientUserId", "appointmentId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_senderId_idx" ON "Message"("senderId");

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");

-- CreateIndex
CREATE INDEX "Message_archivedAt_idx" ON "Message"("archivedAt");

-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "MessageNotification_userId_idx" ON "MessageNotification"("userId");

-- CreateIndex
CREATE INDEX "MessageNotification_unreadCount_idx" ON "MessageNotification"("unreadCount");

-- CreateIndex
CREATE UNIQUE INDEX "MessageNotification_conversationId_userId_key" ON "MessageNotification"("conversationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "EmailNotificationQueue_recipientUserId_idx" ON "EmailNotificationQueue"("recipientUserId");

-- CreateIndex
CREATE INDEX "EmailNotificationQueue_status_idx" ON "EmailNotificationQueue"("status");

-- CreateIndex
CREATE INDEX "EmailNotificationQueue_conversationId_idx" ON "EmailNotificationQueue"("conversationId");

-- CreateIndex
CREATE INDEX "SalonTatoueurTeamRequest_salonId_idx" ON "SalonTatoueurTeamRequest"("salonId");

-- CreateIndex
CREATE INDEX "SalonTatoueurTeamRequest_tatoueurUserId_idx" ON "SalonTatoueurTeamRequest"("tatoueurUserId");

-- CreateIndex
CREATE INDEX "SalonTatoueurTeamRequest_status_idx" ON "SalonTatoueurTeamRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SalonTatoueurTeamRequest_salonId_tatoueurUserId_status_key" ON "SalonTatoueurTeamRequest"("salonId", "tatoueurUserId", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProfile" ADD CONSTRAINT "ClientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Moodboard" ADD CONSTRAINT "Moodboard_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoodboardImage" ADD CONSTRAINT "MoodboardImage_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteUser" ADD CONSTRAINT "FavoriteUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteUser" ADD CONSTRAINT "FavoriteUser_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonReview" ADD CONSTRAINT "SalonReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonReview" ADD CONSTRAINT "SalonReview_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonReview" ADD CONSTRAINT "SalonReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonProfileView" ADD CONSTRAINT "SalonProfileView_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tatoueur" ADD CONSTRAINT "Tatoueur_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_performerUserId_fkey" FOREIGN KEY ("performerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_moodboardId_fkey" FOREIGN KEY ("moodboardId") REFERENCES "Moodboard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_sourceAppointmentId_fkey" FOREIGN KEY ("sourceAppointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_tattooAppointmentId_fkey" FOREIGN KEY ("tattooAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCard" ADD CONSTRAINT "DrawingCard_performerUserId_fkey" FOREIGN KEY ("performerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCardNote" ADD CONSTRAINT "DrawingCardNote_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DrawingCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCardNote" ADD CONSTRAINT "DrawingCardNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCardImage" ADD CONSTRAINT "DrawingCardImage_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "DrawingCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawingCardImage" ADD CONSTRAINT "DrawingCardImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooDetail" ADD CONSTRAINT "TattooDetail_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooDetail" ADD CONSTRAINT "TattooDetail_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooDetail" ADD CONSTRAINT "TattooDetail_piercingServicePriceId_fkey" FOREIGN KEY ("piercingServicePriceId") REFERENCES "PiercingServicePrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiercingPrice" ADD CONSTRAINT "PiercingPrice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiercingServicePrice" ADD CONSTRAINT "PiercingServicePrice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiercingServicePrice" ADD CONSTRAINT "PiercingServicePrice_piercingPriceId_fkey" FOREIGN KEY ("piercingPriceId") REFERENCES "PiercingPrice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalHistory" ADD CONSTRAINT "MedicalHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooHistory" ADD CONSTRAINT "TattooHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TattooHistory" ADD CONSTRAINT "TattooHistory_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aftercare" ADD CONSTRAINT "Aftercare_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedTimeSlot" ADD CONSTRAINT "BlockedTimeSlot_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockedTimeSlot" ADD CONSTRAINT "BlockedTimeSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeSlot" ADD CONSTRAINT "TimeSlot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Portfolio" ADD CONSTRAINT "Portfolio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePortfolio" ADD CONSTRAINT "FavoritePortfolio_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoritePortfolio" ADD CONSTRAINT "FavoritePortfolio_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSalon" ADD CONSTRAINT "ProductSalon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flash" ADD CONSTRAINT "Flash_tatoueurId_fkey" FOREIGN KEY ("tatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flash" ADD CONSTRAINT "Flash_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentConsumable" ADD CONSTRAINT "AppointmentConsumable_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentConsumable" ADD CONSTRAINT "AppointmentConsumable_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentConsumable" ADD CONSTRAINT "AppointmentConsumable_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "SalonVerificationDocument" ADD CONSTRAINT "SalonVerificationDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNotification" ADD CONSTRAINT "MessageNotification_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageNotification" ADD CONSTRAINT "MessageNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailNotificationQueue" ADD CONSTRAINT "EmailNotificationQueue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonTatoueurTeamRequest" ADD CONSTRAINT "SalonTatoueurTeamRequest_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonTatoueurTeamRequest" ADD CONSTRAINT "SalonTatoueurTeamRequest_tatoueurUserId_fkey" FOREIGN KEY ("tatoueurUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
