import { db } from "@/db.js";

/** Canvas v0.2 Postgres schema — see design doc matthewmeakin-unknown-design-20260531-224711.md */
export async function createCanvasTables(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      CREATE TABLE IF NOT EXISTS groups (
        group_id              SERIAL PRIMARY KEY,
        tg_group_id           BIGINT NOT NULL UNIQUE,
        owner_wallet          VARCHAR(42) NOT NULL,
        owner_tg_id           BIGINT NOT NULL,
        verification_task_text TEXT NOT NULL DEFAULT 'In one sentence: what do you use DeFi for?',
        is_active             BOOLEAN NOT NULL DEFAULT true,
        registered_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advertiser_budgets (
        advertiser_id         SERIAL PRIMARY KEY,
        group_id              INT NOT NULL REFERENCES groups(group_id),
        bid_per_verification  BIGINT NOT NULL,
        remaining_budget      BIGINT NOT NULL,
        task_text             TEXT,
        advertiser_tg_id      BIGINT,
        campaign_status       TEXT NOT NULL DEFAULT 'active'
          CHECK (campaign_status IN ('active', 'paused', 'exhausted', 'expired')),
        outbid_notified       BOOLEAN NOT NULL DEFAULT false,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_advertiser_budgets_group_status
        ON advertiser_budgets(group_id, campaign_status);

      CREATE TABLE IF NOT EXISTS bid_log (
        log_id                SERIAL PRIMARY KEY,
        advertiser_id         INT NOT NULL REFERENCES advertiser_budgets(advertiser_id),
        group_id              INT NOT NULL REFERENCES groups(group_id),
        bid_amount            BIGINT NOT NULL,
        placed_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS verifications (
        verification_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tg_user_id            BIGINT NOT NULL,
        group_id              INT NOT NULL REFERENCES groups(group_id),
        advertiser_id         INT REFERENCES advertiser_budgets(advertiser_id),
        state                 TEXT NOT NULL DEFAULT 'PENDING',
        locked_bid_price      BIGINT,
        kimi_score            INT,
        response_text         TEXT,
        attempt_count         INT NOT NULL DEFAULT 1,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at            TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_verifications_user_group
        ON verifications(tg_user_id, group_id);
      CREATE INDEX IF NOT EXISTS idx_verifications_state
        ON verifications(state);

      CREATE TABLE IF NOT EXISTS user_cooldowns (
        tg_user_id            BIGINT NOT NULL,
        group_id              INT NOT NULL REFERENCES groups(group_id),
        cooldown_until        TIMESTAMPTZ NOT NULL,
        PRIMARY KEY (tg_user_id, group_id)
      );

      ALTER TABLE verifications ADD COLUMN IF NOT EXISTS captcha_question_id TEXT;
      ALTER TABLE verifications ADD COLUMN IF NOT EXISTS captcha_correct_option TEXT;
      ALTER TABLE verifications ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'open_join';
      ALTER TABLE verifications ADD COLUMN IF NOT EXISTS task_type TEXT;
      ALTER TABLE verifications ADD COLUMN IF NOT EXISTS task_payload JSONB;
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS last_welcome_message_id BIGINT;
      ALTER TABLE groups ADD COLUMN IF NOT EXISTS portal_invite_link TEXT;
      ALTER TABLE advertiser_budgets ADD COLUMN IF NOT EXISTS template_id INT;

      CREATE TABLE IF NOT EXISTS task_templates (
        template_id           SERIAL PRIMARY KEY,
        advertiser_tg_id      BIGINT,
        name                  TEXT NOT NULL,
        task_type             TEXT NOT NULL
          CHECK (task_type IN ('open_text', 'trivia_mc', 'preference_mc', 'preference_webapp')),
        payload               JSONB NOT NULL,
        preview_image_url     TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } finally {
    client.release();
  }
}
