# Automation Stack local

## Limites da arquitetura

O Career Unified continua sendo a fonte de verdade: executa discovery, matcher, política de elegibilidade, deduplicação e preparação de currículo. O n8n recebe somente eventos minimizados, valida HMAC/timestamp/replay, formata a mensagem e chama a Evolution API. A Evolution apenas entrega WhatsApp.

Não existe acesso n8n → SQLite nem decisão de domínio no workflow. O escopo do n8n termina antes de `submit`; o core pode iniciar AutoApply somente depois do comando WhatsApp autorizado e dos gates descritos em `mass-hunt-autoapply.md`.

## Versões fixadas

- n8n `2.34.6`, imagem `docker.n8n.io/n8nio/n8n:2.34.6`.
- Evolution API `v2.3.7`, imagem `evoapicloud/evolution-api:v2.3.7`.

As versões foram verificadas nos releases oficiais em 14/08/2026. Não foi usada a série Evolution 2.4 porque ela introduz ativação de licença. Consulte os [releases do n8n](https://github.com/n8n-io/n8n/releases) e os [releases da Evolution API](https://github.com/EvolutionAPI/evolution-api/releases) antes de uma atualização deliberada.

## Inicialização

1. Copie `.env.example` para `.env` e gere valores aleatórios longos para os quatro segredos. Não reutilize senhas.
2. Execute `docker compose --profile automation config` e `npm run automation:validate`.
3. Inicie com `docker compose --profile automation up -d --build`.
4. Crie o owner local em `http://127.0.0.1:5678`.
5. Configure a instância Evolution conforme `docs/evolution-whatsapp.md`.
6. Importe o workflow conforme `automation/n8n/README.md`, revise e ative.
7. No Hub, configure o webhook como `http://n8n:5678/webhook/career-whatsapp-alerts`, variável `CAREER_N8N_WEBHOOK_SECRET`, salve e execute os testes.

Os serviços n8n/Evolution/Postgres/Redis só entram quando o profile `automation` é selecionado. App, n8n e APIs administrativas são publicados apenas em loopback.

## Segurança e operação

- `N8N_ENCRYPTION_KEY` protege credenciais salvas pelo n8n; o volume `/home/node/.n8n` é persistente.
- A chave Evolution aparece apenas nos ambientes dos containers n8n/Evolution.
- O webhook usa `HMAC-SHA256(timestamp + "." + rawBody)`, janela de cinco minutos e replay cache pelo event ID.
- O outbox do Hub é retryable e independente da transação de domínio.
- O workflow começa inativo e aceita apenas `JOB_HIGH_MATCH`, `JOB_MATCH_DIGEST_READY` e `INTEGRATION_TEST`.
- O `Code` node precisa de `crypto` e de acesso às variáveis exclusivas do n8n. Em ambiente compartilhado, migre a chave Evolution para Header Auth Credentials e restrinja esse acesso.

Para auditoria periódica do n8n, execute dentro do container `n8n audit`; veja a [documentação oficial de segurança](https://docs.n8n.io/hosting/securing/overview/) e a [documentação Docker](https://docs.n8n.io/hosting/installation/docker/).

## Diagnóstico

- `docker compose --profile automation ps`
- `docker compose --profile automation logs n8n evolution-api`
- `npm run automation:validate`
- `npm run automation:test`

O teste real de WhatsApp só deve ser disparado pela tela depois que o número alvo for conferido. Falha de n8n/Evolution não invalida vagas, análises ou versões de currículo.

No Discovery V3, `JOB_HIGH_MATCH` inclui deep link estável e método de candidatura, mas não exige `ResumeVersion`. Alertas repetidos usam fingerprint da oportunidade canônica; o limite instantâneo e quiet hours geram deferimento/digest em vez de rajada. A tela chama a Evolution diretamente apenas para instance, QR, estado e teste explícito; entregas reais continuam pelo outbox → n8n → Evolution.

## Experience V2.1

O QR é consultado imediatamente e depois em intervalos limitados por cerca de 120 segundos, com expiração e retry explícitos. Reconexão e mensagem de teste continuam opt-in; a UI não envia mensagem automaticamente nem transforma health de container em homologação de entrega real.
