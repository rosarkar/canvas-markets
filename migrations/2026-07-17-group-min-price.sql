-- Conversational /register: group owners now state a price per verification.
-- groups had no price column (verified against src/adapters/schema.ts before writing).
-- Stored as USDC microunits per repo convention. Apply once to the live DB;
-- schema.ts carries the idempotent boot-time equivalent.

ALTER TABLE groups ADD COLUMN min_price_micro BIGINT;
