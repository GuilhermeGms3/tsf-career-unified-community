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
