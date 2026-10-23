# Discovery Recovery P1

## Escopo e autoridade

Correcao dos problemas observados no benchmark completo de 12/10/2026:
notas altas sem descricao, identidades Lever terminadas em `/apply`, duplicatas
remotas entre fontes e repeticao onerosa de consultas a portais indisponiveis.
Nao habilita AutoSubmit nem contorna CAPTCHA, login ou bloqueios HTTP.

## Qualidade da vaga

O modelo `confidence-calibrated-v2` exige pelo menos 100 caracteres e 15 palavras
de descricao normalizada para uma analise nao provisoria. Abaixo disso:

- confianca multiplicada por 0,35, sempre LOW;
- nota calibrada limitada a 59, sem alterar o match conhecido historico;
- elegibilidade REVIEW_REQUIRED, preservando NOT_ELIGIBLE;
- aviso visivel nos cards e no workspace;
- politica ATS nao inicia AutoApply; o orquestrador tambem verifica a condicao.

Esse limite minimo nao comprova qualidade semantica do texto. Os demais gates
de evidencia, revisao editorial, consentimento e recibo continuam necessarios.
Analises v1 ficam RECALCULATION_REQUIRED, sem exclusao de historico.

Gupy e SmartRecruiters enriquecem detalhes publicos das vagas que passaram no
pre-match, antes do matching. Cada rodada tenta ate 30 detalhes e deixa de
iniciar novas consultas apos consumir 30 segundos de enriquecimento. Uma
consulta ja iniciada ainda obedece ao timeout/retries do SafeHttpClient.
Demais vagas incompletas permanecem em revisao; nao se alega enriquecimento
integral de milhares de anuncios. Falhas sao registradas como
JOB_DETAIL_ENRICHMENT_FAILED, sem marcar a vaga encerrada.

Um resumo de board com menos de 100 caracteres nao substitui descricao completa
ja persistida. Detalhes Gupy validam tenant, ID e destino final; SmartRecruiters
valida o ID retornado pela API publica.
O enriquecimento registra snapshot UPDATED e reavalia pre-match com os dados
novos. Expiracao explicita passada fecha a vaga; idade isolada nao e usada
como prova de encerramento.

## Identidade e deduplicacao

Lever `/empresa/ID/apply` usa ID, nao a palavra `apply`. SmartRecruiters remove
o slug do cargo apos o ID numerico. Novas consultas nao repetem a colisao.
Registros antigos ja colididos nao sao reconstruidos por adivinhacao; consultar
o board novamente recupera identidades corretas sem apagar historico.

Anuncios com mesma empresa/cargo e escopo remoto Brasil agrupam local vazio,
Brasil e Remoto - Brasil. Cidades diferentes e pais estrangeiro explicito nao
sao agrupados. A projecao e o Mass Hunt preferem o anuncio com descricao
completa; a rodada nao prepara dois curriculos para a mesma assinatura e
reconhece candidatura existente em anuncio equivalente. Os registros e as
proveniencias originais permanecem no banco. Nao e deduplicacao fuzzy universal.

## Falhas e recuperacao

O SafeHttpClient existente continua com retries limitados e backoff para 5xx,
429 e timeout. Depois de duas consultas consecutivas falharem na mesma fonte
de busca, o Mass Hunt adia as restantes desta fonte nessa rodada. Boards de
empresas diferentes nao compartilham esse bloqueio. Para JobSpy, o isolamento
e por portal e superficie geografica; falha no Glassdoor nao bloqueia Indeed
nem impede testar outra regiao. Uma rodada nova permite nova tentativa.

- 403/autenticacao: verificar portal/Cofre, sem bypass nem retry cego.
- 404/identidade: revisar URL do board; nao encerrar anuncios por erro tecnico.
- Localizacao nao suportada: ajustar a regiao.
- 5xx/timeout/429: aguardar e repetir apenas a fonte.
- Vazio: refinar termo/localizacao, sem declarar indisponibilidade.

Historico de Vagas mostra o tratamento e permite `Buscar so [portal]`.
O resumo HTTP carrega apenas diagnostico compacto das fontes, sem carregar
pre-match, curriculos ou relatorio completo de cada rodada.

## Contrato HTTP

`POST /api/job-hunt/runs/:id/source`

Body: `{ "source": "recrutei" }`.
Exige JSON e o guard local/same-origin existente. A fonte deve constar no
relatorio da rodada; portais JobSpy sao selecionados individualmente.
Retorna 202 com `{ ok, run, runId, status, reused }`.
Erros: JOB_HUNT_RUN_NOT_FOUND / JOB_HUNT_PROFILE_NOT_FOUND (404),
JOB_HUNT_SOURCE_INVALID (400), ou erro do guard de origem.

Cria/reutiliza perfil manual desativado com apenas a fonte selecionada,
mesma geografia, familias, limites e boards aplicaveis. Nao altera agenda
original e nao gera curriculos/candidaturas. Cliques repetidos reutilizam a
rodada ativa. O radar e a pausa existentes continuam disponiveis.

## Verificacao

Regressoes: `tests/discovery-recovery-p1.test.mjs`, matching, discovery,
orquestrador, dispatcher e calibracao. Teste Playwright em
`tests/experience-v2.test.mjs`: historico -> buscar so Recrutei -> radar ->
minimizar, em desktop/mobile, sem overflow ou erro JavaScript.
Browser plugin ausente; verificacao visual pelo Playwright do repositorio.
Testes HTTP usam fixtures, nao enviam candidaturas externas.

## Consulta publica real em 12/10/2026

- Gupy: descricao de 44 para 3.100 caracteres.
- SmartRecruiters: detalhe publico com 4.216 caracteres.
- Lever: dez anuncios retornaram dez IDs distintos.
- Solides: cinco vagas com status HEALTHY; consulta especifica por suporte
  retornou EMPTY, corretamente sem alegar bloqueio.
- Recrutei: HTTP 502 ainda presente; tratamento evita repetir todas as consultas
  e permite nova rodada direcionada. Nao se declara corrigido o servidor externo.
- Snapshot isolado: anuncio sem descricao antes com 88 passou a 59 pontos;
  tres anuncios equivalentes de fontes diferentes viraram uma oportunidade.

Nenhuma LLM, mensagem WhatsApp ou candidatura externa foi acionada nesta
validacao. Os dados produtivos nao foram usados como alvo de escrita.

## Fechamento de verificacao

- `npm test`: 1.241/1.241, zero falhas; regressao final isolada 11/11.
- Testes focados com UI: 64/64; desktop e mobile sem overflow/erro JavaScript.
- `npm run check:syntax`: PASS, 491 arquivos.
- `npm run check:css-tokens`: nenhum token indefinido.
- `git diff --check`: sem erros; avisos de conversao LF/CRLF do Git preservados.
- `docker compose build app`: imagem reconstruida. Smoke em container efemero,
  sem rede e com `/app/data` em tmpfs: `/`, `/api/projects` e historico resumido
  responderam 200; modelo v2 e controles por portal confirmados na imagem.
- Container de smoke removido. Stack produtiva mantida parada como estava,
  evitando iniciar automacoes ou envios como efeito colateral da validacao.
