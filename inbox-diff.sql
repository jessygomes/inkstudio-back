-- CreateEnum
CREATE TYPE "InboxChannel" AS ENUM ('INKERA', 'INSTAGRAM', 'FACEBOOK', 'EMAIL');

-- CreateEnum
CREATE TYPE "InboxThreadStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'DONE');

-- CreateEnum
CREATE TYPE "ChannelProvider" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'GMAIL', 'OUTLOOK', 'IMAP_SMTP');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "ExternalMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ExternalMessageStatus" AS ENUM ('RECEIVED', 'PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "provider" "ChannelProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "displayName" TEXT,
    "emailAddress" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "syncCursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalContact" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerContactId" TEXT NOT NULL,
    "displayName" TEXT,
    "username" TEXT,
    "email" TEXT,
    "profileImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalConversation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerThreadId" TEXT NOT NULL,
    "contactId" TEXT,
    "subject" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalMessage" (
    "id" TEXT NOT NULL,
    "externalConversationId" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "direction" "ExternalMessageDirection" NOT NULL,
    "status" "ExternalMessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "contentText" TEXT,
    "contentHtml" TEXT,
    "senderExternalId" TEXT,
    "toAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ccAddresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentByUserId" TEXT,
    "providerCreatedAt" TIMESTAMP(3),
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "providerFileId" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "fileUrl" TEXT,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxThread" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "channel" "InboxChannel" NOT NULL,
    "conversationId" TEXT,
    "externalConversationId" TEXT,
    "linkedClientId" TEXT,
    "assignedUserId" TEXT,
    "assignedTatoueurId" TEXT,
    "assignedByUserId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "status" "InboxThreadStatus" NOT NULL DEFAULT 'NEW',
    "archivedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxThreadAppointment" (
    "id" TEXT NOT NULL,
    "inboxThreadId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxThreadAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxMemberPermission" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "memberUserId" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canReply" BOOLEAN NOT NULL DEFAULT false,
    "canAssign" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxMemberPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxInternalNote" (
    "id" TEXT NOT NULL,
    "inboxThreadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxInternalNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxReadState" (
    "id" TEXT NOT NULL,
    "inboxThreadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "forceUnread" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InboxReadState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedReply" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" "InboxChannel",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_ownerUserId_provider_status_idx" ON "ChannelConnection"("ownerUserId", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_provider_providerAccountId_key" ON "ChannelConnection"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalContact_connectionId_providerContactId_key" ON "ExternalContact"("connectionId", "providerContactId");

-- CreateIndex
CREATE INDEX "ExternalConversation_connectionId_lastMessageAt_idx" ON "ExternalConversation"("connectionId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalConversation_connectionId_providerThreadId_key" ON "ExternalConversation"("connectionId", "providerThreadId");

-- CreateIndex
CREATE INDEX "ExternalMessage_externalConversationId_providerCreatedAt_idx" ON "ExternalMessage"("externalConversationId", "providerCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalMessage_externalConversationId_providerMessageId_key" ON "ExternalMessage"("externalConversationId", "providerMessageId");

-- CreateIndex
CREATE INDEX "ExternalAttachment_messageId_idx" ON "ExternalAttachment"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxThread_conversationId_key" ON "InboxThread"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxThread_externalConversationId_key" ON "InboxThread"("externalConversationId");

-- CreateIndex
CREATE INDEX "InboxThread_ownerUserId_channel_status_idx" ON "InboxThread"("ownerUserId", "channel", "status");

-- CreateIndex
CREATE INDEX "InboxThread_ownerUserId_linkedClientId_idx" ON "InboxThread"("ownerUserId", "linkedClientId");

-- CreateIndex
CREATE INDEX "InboxThread_assignedUserId_idx" ON "InboxThread"("assignedUserId");

-- CreateIndex
CREATE INDEX "InboxThread_assignedTatoueurId_idx" ON "InboxThread"("assignedTatoueurId");

-- CreateIndex
CREATE INDEX "InboxThreadAppointment_appointmentId_idx" ON "InboxThreadAppointment"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxThreadAppointment_inboxThreadId_appointmentId_key" ON "InboxThreadAppointment"("inboxThreadId", "appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "InboxMemberPermission_salonId_memberUserId_key" ON "InboxMemberPermission"("salonId", "memberUserId");

-- CreateIndex
CREATE INDEX "InboxInternalNote_inboxThreadId_createdAt_idx" ON "InboxInternalNote"("inboxThreadId", "createdAt");

-- CreateIndex
CREATE INDEX "InboxReadState_userId_forceUnread_idx" ON "InboxReadState"("userId", "forceUnread");

-- CreateIndex
CREATE UNIQUE INDEX "InboxReadState_inboxThreadId_userId_key" ON "InboxReadState"("inboxThreadId", "userId");

-- CreateIndex
CREATE INDEX "SavedReply_ownerUserId_isActive_idx" ON "SavedReply"("ownerUserId", "isActive");

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalContact" ADD CONSTRAINT "ExternalContact_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalConversation" ADD CONSTRAINT "ExternalConversation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalConversation" ADD CONSTRAINT "ExternalConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "ExternalContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMessage" ADD CONSTRAINT "ExternalMessage_externalConversationId_fkey" FOREIGN KEY ("externalConversationId") REFERENCES "ExternalConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMessage" ADD CONSTRAINT "ExternalMessage_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalAttachment" ADD CONSTRAINT "ExternalAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ExternalMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_externalConversationId_fkey" FOREIGN KEY ("externalConversationId") REFERENCES "ExternalConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_linkedClientId_fkey" FOREIGN KEY ("linkedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_assignedTatoueurId_fkey" FOREIGN KEY ("assignedTatoueurId") REFERENCES "Tatoueur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThread" ADD CONSTRAINT "InboxThread_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThreadAppointment" ADD CONSTRAINT "InboxThreadAppointment_inboxThreadId_fkey" FOREIGN KEY ("inboxThreadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxThreadAppointment" ADD CONSTRAINT "InboxThreadAppointment_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMemberPermission" ADD CONSTRAINT "InboxMemberPermission_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxMemberPermission" ADD CONSTRAINT "InboxMemberPermission_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxInternalNote" ADD CONSTRAINT "InboxInternalNote_inboxThreadId_fkey" FOREIGN KEY ("inboxThreadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxInternalNote" ADD CONSTRAINT "InboxInternalNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReadState" ADD CONSTRAINT "InboxReadState_inboxThreadId_fkey" FOREIGN KEY ("inboxThreadId") REFERENCES "InboxThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxReadState" ADD CONSTRAINT "InboxReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
