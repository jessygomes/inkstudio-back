-- Certains webhooks Instagram utilisent un identifiant distinct de /me.id.
-- La colonne est additive pour préserver les connexions externes existantes.
ALTER TABLE "ChannelConnection" ADD COLUMN "providerUserId" TEXT;
