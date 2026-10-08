# Resume archetypes

Archetypes definem a estrategia de conteudo; templates definem apenas a apresentacao. O sistema inclui `INFRA_NOC`, `CLOUD_DEVOPS`, `CYBER_SOC`, `BACKEND_PYTHON` e o fallback conservador `GENERAL`.

`ResumeArchetypeSelector` pontua cargo, dominio, skills da vaga, hard requirements e evidencias do candidato. Somente assignments `APPROVED` podem selecionar um curriculo base. A preparacao cria assignments `REVIEW_REQUIRED`; aprovacao e rejeicao sao sempre explicitas.

O perfil local pode manter os campos legados e `resumeData` com arrays estruturados de experiencias, formacao, projetos, certificacoes, idiomas e skills. Dados pessoais nao fazem parte dos archetypes, migrations ou fixtures.
