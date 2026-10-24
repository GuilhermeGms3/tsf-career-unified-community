# AutoSubmit nos Cofres

Dois blocos preparam o envio automático para todos os portais com Cofre, sem afrouxar nenhum gate.

## 1. Homologação local de envio

O envio automático (limiar de nota do Autopilot) exige homologação vigente do portal, do cenário do
formulário e da versão do adapter. Antes, a única fonte era `SUBMIT_EVIDENCE`, vazia na Community, e
nenhuma instalação conseguia liberar portal algum. Agora cada instalação registra a própria evidência:

1. Uma candidatura passa pelo Controlled Submit (preflight, consentimento, clique único e recibo).
2. Você confirma fora da página de envio que ela chegou: lista de candidaturas do portal, e-mail ou
   contato do recrutador.
3. `POST /api/applications/:id/submit-homologation` com `{ "externalConfirmation": "PORTAL_APPLICATION_LIST", "validDays": 30 }`
   grava a homologação (tabela `submit_homologations`, migration 059).

A homologação vale só para aquele portal + cenário + versão do adapter + versão do motor de formulário,
por no máximo 90 dias contados do envio. No Gupy, que envia pelo Application Batch, a versão é a do
adapter V2 (`gupy-application-v3`) e o cenário vem do rascunho: `application-form` (uma etapa) ou
`multi-step`. Antes o Gupy nunca enviava pelo limiar de nota; agora envia só com homologação vigente. Mudou o adapter, venceu ou foi revogada
(`POST /api/submit-homologations/:id/revoke`), o envio automático volta a parar em revisão.
`GET /api/submit-homologations` lista tudo com o campo `active`.

Ela não substitui nada por envio: sessão, formulário fresco, consentimento, recibo e aprovação
continuam obrigatórios a cada candidatura.

## 2. Motor de última milha por perfil

`src/automation/ats/last-mile/last-mile-engine.mjs` concentra a parte final que antes só o Gupy tinha:
rede restrita aos hosts oficiais do Cofre (e nenhum POST em DRY_RUN), avanço de etapa com um único botão,
botão final único e confirmação que precisa surgir depois do clique. Sem confirmação o resultado é
`UNCERTAIN` e não existe segundo clique.

Cada portal é um perfil em `src/automation/ats/last-mile/portal-submit-profiles.mjs`, com nome e hosts
vindos do registro de Cofres. O Gupy usa o motor com o perfil completo, sem mudar de comportamento. Os
outros dez Cofres (Indeed, Sólides, Recrutei, IEL, InfoJobs, Catho, Vagas.com.br, ProgramaThor,
GeekHunter, EMPREGARE) já têm perfil, mas `INCOMPLETE`: falta o texto do botão final e o texto de
confirmação, e o envio deles para antes de qualquer clique (`<PORTAL>_SUBMIT_PROFILE_INCOMPLETE`).
`GET /api/experience/application-capabilities` mostra `submitProfile.status` e o que falta.

### Entrada da candidatura ("Candidatar-se")

Nos portais com Cofre a candidatura começa por um botão na página da vaga ("Candidatar-me", "Quero me
candidatar", "Tenho interesse nessa vaga", "Candidatura rápida"...). Logado, esse clique pode já ser o
envio (InfoJobs, Sólides, Empregare e GeekHunter, segundo as páginas públicas). Por isso:

- O preenchimento (FILL_ONLY) nunca clica na entrada. A página da vaga com um único botão de entrada fora
  de formulário vira o cenário `apply-entry`: saudável, sem campos a preencher, pronta para envio. Antes
  ela terminava em "layout não suportado". Busca e newsletter da página não contam como campos.
- Questionário logado sem nome, e-mail ou CV, com a sessão do Cofre aplicada, vira `logged-in-form` em
  vez de "layout não suportado": o portal já tem esses dados.
- `enterApplication` (motor de última milha) faz o clique de entrada armado como envio
  (`onActionTriggered` antes do clique) e tem quatro desfechos: `SUBMITTED` (confirmação do perfil),
  `FORM` (abriu formulário: seguir a última milha), `LOGIN_REQUIRED`/`CHALLENGE` (handoff humano) ou
  `UNCERTAIN` (sem evidência; texto de sucesso genérico sem confirmação do perfil também fica incerto).
  Nunca há segundo clique. Ele só deve ser usado no caminho de envio com consentimento.
- Com navegador visível, a janela pronta para envio fica aberta para a pessoa concluir, em vez de fechar.

### Envio controlado dos Cofres

O envio dos dez Cofres (todos menos o Gupy) é opt-in por portal: `CAREER_VAULT_SUBMIT_PROVIDERS=catho,vagas`.
Vazio por padrão, porque Indeed, InfoJobs e GeekHunter proíbem automação nos termos de uso e a conta pode
ser bloqueada. Só os portais listados viram `CONTROLLED_SUBMIT` no registry e ganham `submit`; os demais
continuam no preenchimento assistido. Continuam valendo `CAREER_SUBMISSION_ENABLED`, preflight fresco,
consentimento por candidatura, limite de tentativas e recibo.

- `VaultFinalRevalidator` (`src/application/vault-final-revalidator.mjs`): abre a vaga com a sessão do
  Cofre (sem sessão: `LOGIN_REQUIRED`, nada abre), detecta sessão recusada, lê na própria página se a vaga
  está aberta, encerrada ou já candidatada (`vaultJobStatus`) e só segue com entrada ou botão final visível.
- Travessia progressiva (`progressiveSubmit`): entrada, etapas com "Próximo"/"Continuar" e botão final.
  O envio é armado uma vez, antes do primeiro clique que pode entregar; cada clique vira o evento
  `SUBMIT_STEP` na candidatura. Etapas reveladas depois da entrada são preenchidas com respostas já
  confirmadas; pergunta obrigatória nova fica salva para você responder e a tentativa termina incerta.
- Sem campo de CV na página, o portal envia o currículo salvo na conta: o transporte registra
  `SUBMISSION_USES_PORTAL_RESUME` em vez de exigir o PDF da vaga anexado.
- Confirmação: `SUBMITTED` com o `successText` do perfil (ou com a IA local, abaixo). Sem nenhum dos dois,
  um texto de sucesso genérico fica registrado (`SUCCESS_TEXT_OBSERVED`) e o envio termina `UNCERTAIN`.
  Você confere em "Minhas candidaturas", resolve como enviado (`resolution: "SENT"`) e pode homologar o
  Cofre: o caminho completo está coberto em `tests/vault-controlled-submit.test.mjs`.

### IA local na última milha

Com `CAREER_LAST_MILE_LLM=true`, a IA local já configurada na Inteligência (qwen no Ollama ou LM Studio)
ajuda em dois pontos onde as regras do perfil não decidem. Ela nunca age sozinha: só escolhe entre opções
que o código listou, e cada resposta passa por travas fixas (`src/intelligence/tasks/last-mile-assistant.mjs`).

- **Qual botão clicar** (`LAST_MILE_ACTION`): quando há dois botões finais (o "Enviar" da newsletter ao lado
  do "Enviar candidatura") ou nenhum botão com o rótulo esperado ("Enviar minha candidatura agora", "Ir
  para a próxima etapa"). O código lista até 25 botões visíveis e habilitados; links ficam de fora. A
  escolha só vale se o id estiver na lista, o rótulo tiver cara de envio (FINAL) ou de avanço (NEXT), não
  for cancelar, voltar, salvar rascunho, seguir empresa, filtro, alerta, login ou cadastro, e a confiança
  for de pelo menos 0,7. O rótulo é conferido de novo antes do clique. O clique continua armado uma vez só
  e vai para `SUBMIT_STEP` com `source: "MODEL"`.
- **Se a candidatura chegou** (`LAST_MILE_CONFIRMATION`): depois do clique de entrada ou do botão final,
  só textos de sucesso **novos** (não estavam na tela antes), visíveis, num host oficial do Cofre e sem
  palavra de falha ("não", "erro"...) chegam à IA. Se ela afirma que um deles confirma o envio, o resultado
  é `SUBMITTED` com recibo `verificationMethod: "LLM_CONFIRMED_DOM_V1"` e o texto observado, sem precisar da
  confirmação manual. Senão, fica `SUCCESS_TEXT_OBSERVED` e o envio termina incerto como antes.

IA desligada, fora do ar, lenta (limite de 12 s) ou fora das travas: nada muda, a última milha segue
determinística. O `successText` do perfil, quando existe, continua tendo prioridade. A entrada
("Candidatar-se") nunca é escolhida pela IA: botões repetidos ali costumam ser de outras vagas.
Testes: `tests/last-mile-assistant.test.mjs` e o caso ponta a ponta em `tests/vault-controlled-submit.test.mjs`.

### Questionários de TI

As etapas de questionário (no preenchimento e na travessia do envio) respondem sozinhas as perguntas de
TI mais comuns, a partir do que você já confirmou em Conhecimento: evidências de uso de cada tecnologia e
idiomas com nível. A classificação está em `src/application/question-semantics.mjs` e a conversão para a
opção do formulário em `src/application/it-question-answers.mjs`.

| Pergunta | De onde vem a resposta |
| --- | --- |
| "Possui experiência com Linux?" (Sim/Não ou caixa) | Sim com uso profissional ou freelance confirmado; Não só se você confirmou "nunca usei" |
| "Tem conhecimento em Docker?" (Sim/Não) | Sim com uso real em qualquer contexto (curso, projeto, trabalho); só leitura não conta |
| "Quantos anos com Java?" ou "Experiência com AWS" com faixas ("1 a 3 anos") | Soma dos períodos profissionais confirmados, em anos completos |
| "Qual seu nível de inglês?" / "Espanhol" | Idioma confirmado com nível ("Inglês fluente", "B2") |
| "Quantos anos de experiência você tem?" | Total de anos do seu perfil |

Travas: uma tecnologia por pergunta ("Java ou Python?" fica com você); o nível nunca passa do seu (fluente
vira "Avançado" se for o maior oferecido, nunca o contrário); faixa de anos só com opção única compatível;
menos de um ano em campo numérico fica com você. Pergunta de anos sobre algo específico que não é uma
tecnologia conhecida ("anos com Rust", "anos em suporte técnico") não recebe mais o total de carreira. Sem
base, a pergunta fica salva na candidatura para você responder; se você marcar a resposta para reutilizar,
ela vale para a mesma pergunta do mesmo portal, mesmo com outra redação. Pretensão salarial, dados sensíveis e consentimentos
continuam sempre com você.

Listas (`<select>`) com valor interno diferente do texto agora são escolhidas pelo valor: antes cada uma
esperava 30 s antes de acertar. Testes: `tests/it-questionnaire.test.mjs`.

## Para liberar um portal

1. Capturar o fluxo real de uma candidatura no portal:

   ```
   npm run capture:portal -- --provider=catho --url=https://www.catho.com.br/vagas/...
   ```

   Abre um navegador novo, sem sessão do TSF. Você faz login, preenche e envia a candidatura; o script só
   observa, nunca clica nem digita. Cada tela estável vira `step-NN.html` (sem scripts, imagens, valores
   digitados, query de links nem dados pessoais) e `step-NN.json` (botões, títulos, campos e mensagens),
   em `data/captures/` (fora do Git). Os dados do seu perfil no TSF são mascarados quando o Hub está no ar;
   `--redact="Nome,outro"` acrescenta termos. O `manifest.json` traz a proposta de perfil: botão final,
   texto de confirmação e botão de avanço sugeridos. Revise os arquivos antes de compartilhar.
2. Completar o perfil com `finalButton`, `successText` (e `progressionButton` se houver etapas) a partir
   da proposta, com testes sobre a fixture capturada.
3. Ligar a revalidação final do portal no `FinalRevalidatorRouter` e promover a capability no registry.
4. Fazer um envio real controlado e registrar a homologação local.

Não há automação de login, CAPTCHA, MFA ou confirmação por e-mail: esses passos continuam com você.

Validação: `npm run autosubmit:validate`.
