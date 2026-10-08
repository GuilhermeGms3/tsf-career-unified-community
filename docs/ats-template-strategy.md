# ATS template strategy

O default para novas candidaturas e `BASE_01/base-01-v4`, fiel ao PDF aprovado pelo usuario. Ele preserva cabecalho centralizado, ordem das secoes, competencias agrupadas e links clicaveis. `OVERLEAF_BLUE` e `OVERLEAF_CLASSIC` sao alternativas visuais preenchidas pelo mesmo `ResumeSpec`; os dados de exemplo dos codigos Overleaf nunca sao usados. `ATS_TECH` prioriza competencias tecnicas; `ATS_BALANCED` equilibra competencias, experiencia e projetos; `ATS_EARLY_CAREER` antecipa projetos e formacao para estagio e junior; `ATS_IMPACT` prioriza experiencia, resultados e lideranca. `PROFESSIONAL/professional-v2` usa hierarquia discreta; `COMPACT/compact-v2` reduz espacamento sem fonte abaixo de 10pt.

O workspace preseleciona `BASE_01` para evitar regressao visual silenciosa. O usuario continua podendo trocar o modelo antes de gerar a versao. Todos os modelos recebem o mesmo `ResumeSpec` factual e passam pela mesma revisao, EvidenceGuard, comparacao ATS e validacao do PDF.

`ATS_CLEAN/ats-clean-v1`, `PROFESSIONAL/professional-v1` e `COMPACT/compact-v1` permanecem registrados para reproduzir versoes historicas. Uma versao sempre persiste ID e versao exatos do template.

Execute `npm run resume:benchmark` dentro do stack Docker para produzir e extrair os PDFs sanitizados de todos os templates ATS ativos em pt-BR e ingles. O resultado persistido registra parseabilidade, paginas, fatos ausentes, secoes detectadas, caracteres e hash do PDF.
