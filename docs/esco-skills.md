# Skills ESCO no match

O match reconhecia apenas o dicionário curado de TI em `src/matching/constants.mjs`. A fase 1 da ESCO
(European Skills, Competences, Qualifications and Occupations, © União Europeia) acrescenta as skills
da taxonomia europeia para vagas e currículos de outras áreas, em português e inglês.

## Como funciona

- `src/matching/esco/esco-skills.json`: extrato da ESCO v1.2.1 (13.939 skills) com rótulo preferido PT e EN,
  tipo (skill/knowledge) e nível de reuso. Gerado por `npm run esco:sync`, que usa a API pública
  `https://ec.europa.eu/esco/api/search` (sem cadastro) e guarda as páginas em `tmp/esco/<versão>`.
- `src/matching/esco/esco-market-terms.mjs`: ponte entre termos de mercado (BR, PT e EN) e conceitos ESCO.
  Os rótulos oficiais são formais ("utilizar software de folha de cálculo") e a ESCO quase não tem sinônimos
  em português (cerca de 3% das skills), então "Excel", "planilhas" e "folhas de cálculo" são declarados aqui.
- `src/matching/esco-skills.mjs`: índice por token. Ordem de prioridade: dicionário curado, termos de mercado
  e rótulos ESCO. Singular/plural, "de/da/do", "infeção/infecção" e grafia PT/BR ("controlo/controle",
  "stocks/estoques", "planeamento/planejamento") caem na mesma chave.
- `findSkillMentions` e `normalizeSkillName` usam o índice, então requisitos da vaga, evidências do
  currículo e a trava anti-invenção do currículo passam a reconhecer os mesmos conceitos. Um conceito
  tem o mesmo nome nas três línguas: "search engine optimisation" e "otimização de motores de busca"
  viram `otimizacao-de-motores-de-busca`.

Ficam de fora skills transversais ("trabalhar em equipa"), rótulos com mais de 4 palavras e palavras soltas
genéricas ou ambíguas ("gestão", "less", "logging"). Requisitos ESCO entram com confiança 0,82, abaixo do
dicionário curado (0,9), e guardam `escoId` e `escoLabel` nos metadados.

`CAREER_ESCO_SKILLS=false` desliga a ESCO e volta ao dicionário curado.

## Limites conhecidos

- Correspondência literal: uma vaga que descreve a skill com outras palavras não é reconhecida. Ampliar
  `esco-market-terms.mjs` resolve casos frequentes; o próximo passo é correspondência semântica.
- As famílias de busca (`job-family-catalog.mjs`) continuam apenas de TI; profissões ESCO são a fase 2.

Validação: `npm run esco:validate`.
