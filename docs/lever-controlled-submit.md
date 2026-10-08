# Lever Controlled Submit

O adapter Lever V2 inspeciona o formulário hospedado, preenche somente respostas autorizadas, valida campos obrigatórios e exige exatamente uma boundary final visível e inequívoca. O clique ocorre uma única vez, depois de consentimento e preflight fresh.

Antes do envio, o backend confirma a publicação pela Postings API pública oficial, reabre a URL `/apply`, verifica challenge, compara assinatura e estrutura do formulário, valida o PDF selecionado e repete o preenchimento. Targets externos aceitos são somente `jobs.lever.co` e `jobs.eu.lever.co`, em HTTPS, sem credenciais e com site/posting compatíveis com a identidade da vaga.

A comparação estrutural usa somente campos críticos para o envio. Elementos auxiliares e respostas invisíveis de CAPTCHA não invalidam uma revisão, mas um challenge visível continua bloqueando o fluxo. O preenchimento fresco reutiliza apenas respostas persistidas com autoridade confirmada, inclusive fatos importados do perfil do candidato.

CAPTCHA, MFA, login ou verificação humana interrompem o fluxo. Ausência de confirmação positiva após o clique produz `SUBMISSION_UNCERTAIN`; não existe retry automático. O runtime externo permanece desligado por padrão e exige `NODE_ENV=production` com `CAREER_SUBMISSION_ENABLED=true`.

Uma falha comprovadamente anterior ao clique pode ser recuperada por `POST /api/applications/:id/submission/retry`, com confirmação explícita. A recuperação exige tentativa `FAILED/PRE_ACTION`, ausência de recibo e um novo preflight; consentimento e chave de idempotência antigos não são reutilizados. Tentativas `ACTION_TRIGGERED` ou `UNCERTAIN` nunca podem usar esse caminho.

Validação: `node --test --test-concurrency=1 tests/lever-controlled-submit.test.mjs`.
