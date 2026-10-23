# Checagem periódica de vagas

## Operação

Em **Automação → Busca e envio → Checagem periódica**, o controle fica logo
abaixo do interruptor geral, fora das configurações avançadas. A agenda de
disponibilidade é independente da busca e da política ATS.

- Ative/desative a agenda, configure intervalo de 1 a 168 horas e lotes de
  10 a 300 vagas. O padrão do produto é desligado, 24 horas e 100 vagas.
- `Verificar agora` consulta o próximo lote do catálogo, sem Mass Hunt,
  geração de currículo, LLM ou candidatura. Repetir durante uma execução
  retorna a mesma rodada, sem duplicá-la.
- A agenda consulta vagas vencidas para rechecagem, em ordem da verificação
  mais antiga. Se houver mais vagas pendentes, continua com outro lote no
  próximo tick de até 60 segundos, sem esperar outro intervalo de 24 horas.
- Vagas encerradas ficam no histórico e podem ser rechecadas individualmente.
  Não são apagadas nem fechadas apenas por terem 30 dias.
- Desligar a agenda impede novos lotes; uma rodada já iniciada termina.
- Última/próxima rodada, progresso, contagens e motivo por vaga aparecem no
  painel. Há rechecagem individual e histórico de rodadas anteriores.

## Autoridade e detecção

`AVAILABLE`, `CLOSED` e `INCONCLUSIVE` são resultados diferentes:

| Caminho | Evidência utilizada |
| --- | --- |
| Greenhouse, Lever, SmartRecruiters | Detalhe público oficial com identidade correspondente; 404/410 direto indica remoção |
| Ashby, Workable | Presença/ausência em catálogo oficial de formato reconhecido e sem indicação de paginação/truncamento |
| Gupy | Identidade da vaga e tenant nos dados públicos; publicação retirada e aviso explícito |
| Nerdin | Página pública `/vaga_emprego/`, nunca a tela de login `/vaga_candidatura.php` |
| Outros portais, incluindo IEL, Recrutei e Sólides | JobPosting correspondente, prazo declarado pelo portal, aviso explícito ou título acompanhado de ação de candidatura |

HTTP 200 sozinho não comprova abertura. Login, CAPTCHA, 403, 429, 5xx,
timeout, formato inesperado ou redirecionamento sem identidade confirmada
são inconclusivos. Inclusive um 404 após redirecionar para login não encerra
a vaga original. Prazo estruturado passado em conflito com um botão de
candidatura ativo também fica inconclusivo, evitando fechar por metadado velho.
Um catálogo truncado ou uma falha no board não comprovam
ausência. Ashby `isListed=false` significa acesso por link direto, não fechamento.

Referências oficiais consultadas:
[Greenhouse](https://docs.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api),
[Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api).

## Filas e persistência

- Encerradas saem da projeção decisiva de Hoje/recomendações e não iniciam
  preparação em lote nem novos envios de PDF/AutoApply por política.
- Uma consulta inconclusiva remove a confirmação de atualidade, mas não
  altera a vaga para CLOSED.
- O AutoApply mantém a checagem antes de preencher e o adapter mantém a
  revalidação final antes de enviar. Candidaturas enviadas e recibos não são
  apagados ou cancelados pela manutenção do catálogo.
- Discovery não reabre um encerramento comprovado por esta verificação nem
  sobrescreve seu resultado. Uma rechecagem positiva permite reabertura.
- O serviço preserva URL canônica e mantém até dez verificações por vaga.
  Rodadas usam `daily_refresh_runs`, com resultados por vaga em `result.checks`.
  A agenda usa `app_metadata`; não há nova tabela ou migration.
- Um lote tem no máximo três consultas concorrentes e cede o event loop entre
  itens. A fila de Hoje é reconstruída ao final, não uma vez por vaga.

## Contratos

| Método e caminho | Contrato |
| --- | --- |
| GET `/api/opportunities/verification-policy` | `{ok, policy, run, runs, continuingSweep}` |
| PUT `/api/opportunities/verification-policy` | Entrada `{enabled:boolean,everyHours:integer,batchSize:integer}`; retorna o mesmo status; limites inválidos: 400 |
| POST `/api/opportunities/verify` | 202 com `{ok,run,statusUrl}`; lote do catálogo usando a política atual |
| GET `/api/opportunities/verify/:id` | Progresso persistido; inexistente: 404 |
| POST `/api/opportunities/:id/verify` | Rechecagem individual, inclusive de encerradas; vaga inexistente: 404 |

São mantidos os controles de origem/autorização das mutações do Hub e o
SafeHttpClient com validação de destino público, redirects, limites de
resposta e deadline. Nenhuma sessão autenticada é necessária para esta agenda.

## Validação reproduzível

`node --test tests/availability-catalog.test.mjs tests/daily-operations-p0.test.mjs tests/discovery-lifecycle.test.mjs tests/resume-approval-dispatcher.test.mjs`

`node scripts/validate-availability-live.mjs tmp/availability-live.json` lê
SQLite em modo read-only e consulta amostras públicas em uma projeção isolada.
Não altera o banco operacional. O relatório separa diagnósticos sem rótulo de
casos com referência de abertura/encerramento; amostra pequena não prova
acurácia universal e resultado inconclusivo não é contado como acerto.

`node scripts/availability-ui-smoke.mjs tmp/availability-ui` valida a tela em
desktop/mobile sem alterar a agenda. `--exercise` é explicitamente mutante:
ativa 24h, testa um lote manual de 20 e restaura o lote para 100. Não envia
currículo nem candidatura. Essa opção é para homologação autorizada.
