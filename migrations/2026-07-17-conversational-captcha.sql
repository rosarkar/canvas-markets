-- Conversational captcha: multi-turn dialogue log + turn counter on verifications.
-- Verified absent from the live schema (src/adapters/schema.ts) before writing.
-- Apply once to the live DB; schema.ts carries the idempotent boot-time equivalent
-- for fresh databases.

ALTER TABLE verifications ADD COLUMN conversation_history JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE verifications ADD COLUMN conversation_turn INT NOT NULL DEFAULT 0;
