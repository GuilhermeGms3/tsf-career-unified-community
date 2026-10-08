UPDATE auto_apply_policy
SET minimum_ats_score = 80,
    whatsapp_minimum_ats_score = 60,
    whatsapp_maximum_ats_score = 79,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'default'
  AND minimum_ats_score = 95
  AND whatsapp_minimum_ats_score = 60
  AND whatsapp_maximum_ats_score = 94;
