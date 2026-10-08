INSERT INTO resume_templates(
  id,version,name,purpose,supported_languages_json,ats_optimized,
  layout_type,max_recommended_pages,enabled,metadata_json,created_at
) VALUES
('BASE_01','base-01-v1','BASE 01 fiel','Estrutura aprovada do PDF BASE 01 com links clicaveis','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"source":"USER_APPROVED_PDF","sectionStrategy":"BASE_01"}',CURRENT_TIMESTAMP),
('OVERLEAF_BLUE','overleaf-blue-v1','Overleaf Azul','Cabecalho editorial azul preenchido com a BASE 01','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"source":"USER_PROVIDED_OVERLEAF","sectionStrategy":"EDUCATION_FIRST"}',CURRENT_TIMESTAMP),
('OVERLEAF_CLASSIC','overleaf-classic-v1','Overleaf Classico','Secoes em faixas discretas preenchidas com a BASE 01','["pt-BR","en"]',1,'ONE_COLUMN',2,1,'{"source":"USER_PROVIDED_OVERLEAF","sectionStrategy":"PROJECTS_FIRST"}',CURRENT_TIMESTAMP);
