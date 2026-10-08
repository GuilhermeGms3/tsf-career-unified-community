ALTER TABLE auto_apply_policy ADD COLUMN whatsapp_minimum_ats_score INTEGER NOT NULL DEFAULT 60 CHECK(whatsapp_minimum_ats_score BETWEEN 0 AND 100);
ALTER TABLE auto_apply_policy ADD COLUMN whatsapp_maximum_ats_score INTEGER NOT NULL DEFAULT 94 CHECK(whatsapp_maximum_ats_score BETWEEN 0 AND 100);

UPDATE auto_apply_policy
SET enabled = CASE WHEN minimum_ats_score = 0 THEN 0 ELSE enabled END,
    whatsapp_maximum_ats_score = MIN(94, MAX(0, minimum_ats_score - 1)),
    whatsapp_minimum_ats_score = MIN(60, MAX(0, minimum_ats_score - 1));
