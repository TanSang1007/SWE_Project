-- DRAFT ONLY: forward compensation after 20261014230000_promotion_campaign.
-- Keep that original migration and all existing _prisma_migrations rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
-- Resolve the migration runner's current schema (also supports UUID test schemas).
LOCK TABLE campaigns, promotions IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM campaigns) THEN
    RAISE EXCEPTION 'STOP: Campaign data exists; preservation decision required';
  END IF;
  IF EXISTS (SELECT 1 FROM promotions WHERE campaign_id IS NOT NULL OR version <> 0) THEN
    RAISE EXCEPTION 'STOP: A07 membership/version data exists';
  END IF;
END $$;
ALTER TABLE campaigns DROP CONSTRAINT campaigns_banner_promotion_fkey;
ALTER TABLE promotions DROP CONSTRAINT promotions_campaign_id_fkey;
DROP INDEX promotions_campaign_id_id_key;
ALTER TABLE promotions DROP CONSTRAINT promotions_version_check;
ALTER TABLE promotions DROP COLUMN campaign_id, DROP COLUMN version;
DROP TABLE campaigns;
COMMIT;
