-- OAuth connections must be reconnected once after upgrading from encrypted storage.
-- Teacher, calculation and document data are unaffected.
ALTER TABLE "GoogleAccount" ADD COLUMN "tokens" JSONB NOT NULL DEFAULT '{}';
UPDATE "GoogleAccount" SET "active" = false;
ALTER TABLE "GoogleAccount" DROP COLUMN "encryptedTokens";
