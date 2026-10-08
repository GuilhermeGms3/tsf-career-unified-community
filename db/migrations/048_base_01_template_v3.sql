INSERT INTO resume_templates(
  id,version,name,purpose,supported_languages_json,ats_optimized,
  layout_type,max_recommended_pages,enabled,metadata_json,created_at
) VALUES (
  'BASE_01','base-01-v3','BASE 01 fiel',
  'Estrutura aprovada do PDF BASE 01 com links clicaveis',
  '["pt-BR","en"]',1,'ONE_COLUMN',2,1,
  '{"source":"USER_APPROVED_PDF","sectionStrategy":"BASE_01"}',CURRENT_TIMESTAMP
);
