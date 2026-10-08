# Resume Document Engine

## Escopo e arquitetura

O motor transforma fatos locais aprovados em uma versao imutavel de curriculo. Ele nao substitui o importador legado nem o Matcher V2. O fluxo e:

1. `ResumeSelector` escolhe um curriculo-base; quando existem versoes-base no novo motor, somente `APPROVED` ou `READY` sao elegiveis.
2. `ResumeTailor` produz um changeset `REVIEW_REQUIRED`; o usuario aprova ou rejeita o conjunto inteiro.
3. `ResumeSpecBuilder` compoe o `ResumeSpec` apenas com CandidateProfile, curriculo-base, evidencias do Matcher e changeset aprovado.
4. `ResumeDocumentValidator` e `EvidenceGuard` bloqueiam fatos, anos e metricas sem evidencia.
5. `LatexTemplateRenderer` escapa todo conteudo e escolhe um template versionado sem participacao do LLM.
6. `LocalLatexCompiler` tenta Tectonic local em modo isolado. Sem compilador, `resume.tex` permanece disponivel e o PDF recebe `PDF_COMPILER_NOT_AVAILABLE`.
7. O PDF e reextraido, validado e submetido novamente a parseabilidade/Matcher. Regressao leva a `REVIEW_REQUIRED`.
8. A candidatura e seu plano guardam `resume_version_id`; o preflight verifica status, caminho, hash e PDF antes de o adapter receber o artefato exato.

O codigo esta isolado em `src/resume/`. A migration `007_resume_document_engine.sql` e aditiva e nao altera migrations anteriores.

## ResumeSpec v1

`ResumeSpec` e JSON canonico sem comandos de apresentacao. Ele inclui candidato/contato/headline/links, resumo, experiencias e bullets, projetos, formacao, certificacoes, skills e idiomas. Afirmacoes revisaveis carregam `evidenceIds`. O hash SHA-256 usa serializacao canonica e alimenta versionamento e idempotencia.

## Versoes e artefatos

`resume_versions` e append-only por contrato da aplicacao. Estados: `DRAFT`, `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `RENDERING`, `READY`, `FAILED` e `ARCHIVED`. Uma nova alteracao cria outra linha com `parent_version_id`; nunca sobrescreve o snapshot anterior.

Artefatos iniciais:

- `LATEX_SOURCE` -> `data/resumes/<resume-id>/versions/<version-id>/resume.tex`
- `PDF` -> `.../resume.pdf`
- `EXTRACTED_TEXT` -> `.../extracted.txt`
- manifesto -> `.../render.json`
- bundle Overleaf -> `.../overleaf-export.zip`

Cada registro guarda hash, tamanho, MIME, status e validacao. O backup usa `METADATA_AND_FILES`: inclui metadados SQLite, os binarios em Base64 e uma lista explicita de arquivos ausentes. Artefatos referenciados por candidatura usam `ON DELETE RESTRICT`.

## Templates

- `BASE_01 / base-01-v4`: reproduz a estrutura visual aprovada do PDF BASE 01, incluindo cabecalho, ordem das secoes, competencias agrupadas e links clicaveis.
- `OVERLEAF_BLUE / overleaf-blue-v2`: alternativa com cabecalho azul baseada no codigo Overleaf fornecido pelo usuario.
- `OVERLEAF_CLASSIC / overleaf-classic-v3`: alternativa com faixas discretas de secao baseada no codigo Overleaf fornecido pelo usuario.
- `ATS_CLEAN / ats-clean-v1`: padrao para candidatura, uma coluna e ordem linear.
- `ATS_STRICT / ats-strict-v1`: leitura conservadora e ordem linear para candidaturas gerais.
- `ATS_TECH / ats-tech-v1`: competencias tecnicas antes da experiencia.
- `ATS_BALANCED / ats-balanced-v1`: equilibrio entre competencias, experiencia e projetos.
- `ATS_EARLY_CAREER / ats-early-career-v1`: projetos e formacao antes da experiencia para inicio de carreira.
- `ATS_IMPACT / ats-impact-v1`: experiencia, resultados e lideranca em primeiro plano.
- `PROFESSIONAL / professional-v1`: hierarquia visual discreta sem depender de tabelas ou imagens.
- `COMPACT / compact-v1`: margens menores, ainda linear e extraivel.

Os tres templates aprovados recebem o mesmo `ResumeSpec` factual da BASE 01; nenhum placeholder ou dado do exemplo Overleaf entra no documento. Versoes de template sao imutaveis. Uma evolucao deve criar `*-v2`, nunca alterar o significado de `*-v1`.

## API local

- `GET /api/resume-documents/templates`
- `GET /api/resume-documents/compiler-health`
- `GET|POST /api/resume-documents/versions`
- `POST /api/resume-documents/tailor`
- `GET /api/resume-documents/versions/:id`
- `POST /api/resume-documents/versions/:id/review`
- `POST /api/resume-documents/versions/:id/render`
- `GET /api/resume-documents/versions/:id/artifacts`
- `POST /api/resume-documents/versions/:id/export`
- `GET /api/resume-documents/artifacts/:id/download`
- `GET /api/resume-documents/jobs/:id`
- `GET /api/resume-documents/metrics`

Operacoes longas retornam `202` e um job persistente. O frontend faz polling e nao prende a requisicao HTTP.

## Politicas seguras

Os defaults ficam em `DEFAULT_RESUME_DOCUMENT_POLICIES`: revisao e evidencia obrigatorias, `ATS_STRICT`, parseabilidade minima 65, ate duas paginas, contato/experiencia obrigatorios, render apos aprovacao, exportacao externa e eventos n8n de documentos desativados. Ajustes devem continuar locais e nunca permitir que n8n/Overleaf se tornem fonte de verdade.

## Limites

- ATS comercial continua opaco; score e parseabilidade sao estimativas locais explicaveis.
- O motor nao gera nem envia candidaturas automaticamente.
- Gupy e Workday continuam sem Application Adapter.
- A compilacao real depende de Tectonic instalado e cache de suporte previamente preparado.

## Experience V2.1

Importação de PDF, DOCX e TXT cria base e versão por job assíncrono. Revisão, evidências, aprovação/rejeição, renderização, retry e downloads usam contratos reais do backend; o mesmo componente de revisão é reutilizado no workspace de oportunidade e na biblioteca de currículos.
