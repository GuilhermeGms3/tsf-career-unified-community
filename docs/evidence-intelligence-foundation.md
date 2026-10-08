# Evidence Intelligence Foundation

## Fluxo de resolução

O Matcher extrai e normaliza requisitos, consulta um `EvidenceProviderRegistry` e resolve cada requisito com evidências canônicas. `candidate-sources` preserva perfil, currículo e Candidate Knowledge V3; `github` consulta somente o índice SQLite já sincronizado. A avaliação de uma vaga nunca chama a API do GitHub.

Cada item passa a registrar `resolution.reason` e `providersChecked`. Os motivos suportados são `EVIDENCE_FOUND`, `NO_EVIDENCE`, `NOT_INDEXED`, `ALIAS_MISSING`, `EXTRACTION_FAILURE`, `AMBIGUOUS`, `INSUFFICIENT_EVIDENCE`, `CONFLICTING_EVIDENCE` e `EXPLICIT_NEGATIVE_OR_INCOMPATIBLE`. `UNKNOWN` continua diferente de `NO_MATCH`: somente uma negativa explícita ou incompatibilidade determinística produz ausência confirmada.

## GitHub Evidence Provider

O cliente usa exclusivamente GitHub REST `GET`. A credencial pode vir do cofre cifrado do Source Connection Center ou de `GITHUB_TOKEN` no ambiente; token, headers e conteúdo de arquivos nunca entram no SQLite, logs, audit events ou Candidate Knowledge. O token recomendado é fine-grained, limitado aos repositórios autorizados e a permissões de leitura de metadata e contents.

O sync é explícito em `POST /api/candidate-knowledge/providers/github/sync`. A leitura pública do estado local fica em `GET /api/candidate-knowledge/providers/github`. A conexão e validação da credencial reutilizam `/api/source-center/credentials/github`.

O provider descobre repositórios acessíveis e classifica `OWNED`, `CONTRIBUTED`, `ORGANIZATION` e `FORK`, além de `PUBLIC`/`PRIVATE`. Repositório próprio pode atribuir seus artefatos objetivos ao candidato. Organização, contribuição e fork exigem paths presentes no histórico atribuível ao login autenticado. Fork não modificado não gera evidência; fork alterado é limitado a `MEDIUM`.

## Índice incremental

`github_repositories` guarda identificador do provedor, relação, visibilidade, branch, HEAD, ETag, versão do detector, status e última sincronização. `github_repository_evidence` guarda tecnologia, tipo de artefato, path, detector, força, confidence, snapshot, atribuição, datas e provenance. Conteúdo-fonte não é persistido.

Na primeira execução, o provider obtém a árvore do HEAD e carrega apenas candidatos relevantes. Em execuções seguintes:

1. HEAD igual produz no-op/cache hit;
2. HEAD novo usa compare para obter paths alterados;
3. somente esses paths são relidos e reconciliados;
4. evidências removidas são arquivadas, sem apagar o histórico;
5. a projeção no Career Evidence Graph usa IDs determinísticos e não duplica em rebuild.

ETag é preservado para árvores; paginação e limites de repositórios, commits e arquivos evitam loops agressivos. Erros transitórios usam backoff limitado. Não há clone.

## Detectores e força

Detectores objetivos suportados:

- Docker: `Dockerfile` e Compose;
- Kubernetes: manifests por nome e `kind`, Kustomize, Helm/charts;
- Terraform e Infrastructure as Code: `.tf`/`.tfvars`;
- GitHub Actions e CI/CD: workflows; também GitLab CI, Jenkins, Azure Pipelines e CircleCI para CI/CD;
- Node.js, Java e Python: manifests de pacote/build;
- AWS, Azure e GCP: configuração explícita de provider Terraform.

A escala local é `WEAK`, `MEDIUM`, `STRONG`, `VERY_STRONG`. README isolado é sempre `WEAK`; manifests e workflows objetivos começam em `STRONG`; combinações coerentes podem chegar a `VERY_STRONG`. Evidência GitHub comprova exposição prática ao artefato, não senioridade, expertise, duração contínua, produção ou experiência profissional.

## Candidate Knowledge V3 e privacidade

O índice é projetado no mesmo Career Evidence Graph, com `sourceType=GITHUB_OBJECTIVE`, `SYSTEM_EXTRACTED`, confidence, snapshot e provenance. Não há segundo Candidate Knowledge. Fatos derivados que perderam todos os artefatos ativos não retornam como menção residual no Matcher.

Para repositórios privados, o nome exibido é neutralizado e somente identificador, path, artifact type, tecnologia, força, snapshot e metadata de atribuição são mantidos. `.env`, chaves, credentials/secrets, binários, arquivos grandes, `node_modules`, vendors e outputs de build são recusados antes da leitura. Código privado não vai para currículo, prompts, documentação ou memória do projeto.

## Limites

Atribuição por commit/path é conservadora, mas não prova autoria integral nem contexto profissional. Datas de primeiro e último sinal indicam observações pontuais, não duração contínua. O Source Center não pede escopos de escrita, e o provider não implementa push, commit, issue, PR, delete ou settings.
