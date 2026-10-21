-- D45/A07: additive Campaign management. No legacy business-row rewrite.
BEGIN;
CREATE TABLE campaigns (
  id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ(6) NOT NULL,
  ends_at TIMESTAMPTZ(6) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT false,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  banner_promotion_id UUID,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT campaigns_pkey PRIMARY KEY (id),
  CONSTRAINT campaigns_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT campaigns_description_check CHECK (char_length(description) <= 300),
  CONSTRAINT campaigns_dates_check CHECK (ends_at > starts_at),
  CONSTRAINT campaigns_version_check CHECK (version >= 0),
  CONSTRAINT campaigns_featured_code_check CHECK (NOT is_featured OR banner_promotion_id IS NOT NULL)
);
ALTER TABLE promotions ADD COLUMN campaign_id UUID, ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE promotions ADD CONSTRAINT promotions_version_check CHECK (version >= 0);
CREATE UNIQUE INDEX promotions_campaign_id_id_key ON promotions(campaign_id,id);
ALTER TABLE promotions ADD CONSTRAINT promotions_campaign_id_fkey FOREIGN KEY(campaign_id)
  REFERENCES campaigns(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_banner_promotion_fkey FOREIGN KEY(id,banner_promotion_id)
  REFERENCES promotions(campaign_id,id) MATCH SIMPLE ON DELETE RESTRICT ON UPDATE RESTRICT;
CREATE UNIQUE INDEX campaigns_one_featured_idx ON campaigns(is_featured) WHERE is_featured;
CREATE INDEX campaigns_public_discovery_idx ON campaigns(id) WHERE is_active AND is_published;
COMMIT;
