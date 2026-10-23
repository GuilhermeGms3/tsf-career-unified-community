# Gateway móvel

O app Android é um cliente fino. Descoberta, ranking, geração de currículo,
AutoApply, AutoSubmit, recibos e persistência continuam sob autoridade do
servidor TSF Career Unified.

## Limite de confiança

O gateway usa uma porta dedicada, versionada em `/api/mobile/v1`, e deve ficar
publicado somente no loopback do host. O Tailscale Serve termina HTTPS, remove
cabeçalhos de identidade forjados e encaminha a identidade autenticada ao
gateway. O backend confere `Tailscale-User-Login` contra uma allowlist.

Não exponha a porta 7125 na LAN, Internet ou em uma regra Docker sem o prefixo
`127.0.0.1`. Banco, Playwright, n8n e Evolution também não devem ser publicados.

## Configuração

No `.env` local:

```dotenv
MOBILE_GATEWAY_ENABLED=true
MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS=usuario@example.com
```

Suba o TSF e publique o gateway dentro da tailnet:

```bash
docker compose up -d --build
tailscale serve --bg --https=443 --set-path=/api/mobile/v1 http://127.0.0.1:7125/api/mobile/v1
tailscale serve status
```

Use no app a URL HTTPS exibida por `tailscale serve status`. Ações mutáveis
exigem `Idempotency-Key`; uma repetição segura recebe o cabeçalho
`Idempotent-Replayed: true`.

Homologacao de conexao em 22/10/2026: imagem de codigo964dbb77f649 no Ubuntu,
HTTPS privado compartilhado com web, health/Hoje/vagas/candidaturas/Caixa/PDF/SSE
verificados no endpoint real. Foram lidas17 candidaturas e17 decisoes; POST de
teste retornou423 em manutencao. Testes locais completos1506/1506, imagem20/20,
sintaxe561 PASS. Isso valida servidor/transporte, nao confirma que o usuario
conseguiu sincronizar o APK no aparelho. Nao houve envio externo nem agendas.

## Contrato inicial

- `GET /api/mobile/v1/health`
- `GET /api/mobile/v1/today`
- `GET /api/mobile/v1/opportunities`
- `GET /api/mobile/v1/opportunities/:id`
- `PUT /api/mobile/v1/opportunities/:id/feedback`
- `GET|POST /api/mobile/v1/hunts`
- `GET /api/mobile/v1/hunts/:id`
- `POST /api/mobile/v1/hunts/:id/pause`
- `GET /api/mobile/v1/applications`
- `GET /api/mobile/v1/decisions`
- `GET /api/mobile/v1/applications/:id`
- `POST /api/mobile/v1/applications/:id/actions`
- `POST /api/mobile/v1/applications/:id/questions`
- `GET /api/mobile/v1/applications/:id/resume.pdf`
- `GET /api/mobile/v1/events` (SSE)

O gateway retorna projeções compactas, nunca o estado SQLite bruto. CAPTCHA,
MFA, login e envio incerto continuam como handoff humano. Candidatura só é
confirmada quando o servidor possui evidência/recibo.

## Consulta durante manutencao

O usuario confirmou sincronizacao do APK com os dados reais em22/10/2026.
Para liberar comandos sem agendas, usar o modo `manual` descrito no
[guia de implantacao](maintenance-deployment.md#operacao-manual). O health retorna
readOnly=false/operationMode=manual; aprovar, retomar, responder, alterar, iniciar
e pausar o Radar ficam sujeitos aos gates existentes. O envio final exige a chave
de submissao e aprovacao explicita da versao. Modo manual nao inicia filas antigas,
WhatsApp ou candidaturas apenas pela nota.

Com `CAREER_OPERATION_MODE=maintenance`, o gateway pode ser habilitado sem
iniciar agendas, workers ou canais. Health informa `readOnly=true` e
`operationMode=maintenance`. Consultas, PDF e SSE continuam disponiveis;
mutacoes retornam HTTP423 `MAINTENANCE_MODE` antes de reservar idempotencia.
Hoje usa somente o snapshot salvo, inclusive com `fresh=true`, sem reconstruir
filas. Acoes do app nao sao uma autorizacao para sair de manutencao.

Quando o proxy esta habilitado, configure seu IP exato em
`MOBILE_GATEWAY_PROXY_ADDRESSES` ou reutilize `CAREER_WEB_PROXY_ADDRESSES`.
Nao basta confiar num header de identidade recebido de qualquer endereco.
Em Docker, use o gateway real da rede dedicada; a publicacao permanece loopback.

Para preservar a web e ser compativel com Android0.3 (origem sem porta),
publique somente o prefixo mobile no mesmo HTTPS privado443:

```sh
tailscale serve --bg --https=443 --set-path=/api/mobile/v1 http://127.0.0.1:7125/api/mobile/v1
```

No app informe `https://<servidor>.<tailnet>.ts.net`, sem adicionar
`/api/mobile/v1`: o cliente Android acrescenta esse caminho. Tailscale precisa
estar conectado no celular com uma identidade permitida. Nao use Funnel.
O destino repoe o mesmo prefixo que Serve retira do mount point; validar
`/api/mobile/v1/health` depois da publicacao, sem substituir o handler web `/`.

A Caixa de decisões reutiliza os comandos idempotentes do servidor para
aprovar, negar, pedir alteração, responder pergunta e retomar um handoff. O SSE
carrega somente tipo e horário do evento; após uma invalidação ou tick sanitizado
de 15 segundos, o app busca a projeção atual pela API. Firestore não é usado. Uma integração futura com FCM
deve transportar apenas um identificador opaco para acordar o app.
