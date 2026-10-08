INSERT INTO resume_templates(
  id,version,name,purpose,supported_languages_json,ats_optimized,
  layout_type,max_recommended_pages,enabled,metadata_json,created_at
) VALUES
('ATS_BALANCED','ats-balanced-v1','ATS Balanced','Equilibrio entre competencias, experiencia e projetos','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"sectionStrategy":"BALANCED"}',CURRENT_TIMESTAMP),
('ATS_EARLY_CAREER','ats-early-career-v1','ATS Early Career','Estagio e inicio de carreira com projetos e formacao em destaque','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"sectionStrategy":"EARLY_CAREER"}',CURRENT_TIMESTAMP),
('ATS_IMPACT','ats-impact-v1','ATS Impact','Experiencia, resultados e lideranca em primeiro plano','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"sectionStrategy":"IMPACT"}',CURRENT_TIMESTAMP);
