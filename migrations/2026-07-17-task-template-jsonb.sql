-- Enriched task-design brief for the conversational captcha agent.
-- Note: the spec named this "campaigns.task_template" — in this schema the campaigns
-- table is advertiser_budgets. task_text stays TEXT (it is read as a plain string in
-- eight call sites: bidding mappers, campaign-approval preview, verification-tasks
-- fallback, advertiser stats); converting it to JSONB would break all of them at
-- runtime. Instead the enriched object gets its own JSONB column; legacy rows keep
-- NULL here and fall back to task_text as before.

ALTER TABLE advertiser_budgets ADD COLUMN task_template JSONB;
