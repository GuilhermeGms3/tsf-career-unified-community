# Evolution API e WhatsApp

O compose fixa a Evolution API 2.3.7 com Postgres e Redis persistentes. A documentação oficial está em [doc.evolution-api.com](https://doc.evolution-api.com/v2/pt/get-started/introduction) e o repositório em [EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api).

O Manager local usa `http://127.0.0.1:8081/manager` por padrão para não disputar a porta `8080` com outros serviços. A porta pode ser alterada por `EVOLUTION_HOST_PORT`; nesse caso, ajuste também `EVOLUTION_MANAGER_URL`. A comunicação interna entre containers continua em `evolution-api:8080`. O runtime limita os logs da Evolution a `ERROR`, o Baileys a `error` e desabilita a retenção do stdout bruto desse container no Docker, pois a Evolution pode incluir identificadores de conversa até em mensagens de erro. A observabilidade operacional permanece nos healthchecks e diagnósticos sanitizados do Hub.

## Conectar pela UI

1. Confirme que `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` e `CAREER_WHATSAPP_TARGET` estão no `.env` local.
2. Abra **Autopilot → Notificações → WhatsApp** e confira separadamente Evolution, WhatsApp, n8n, webhook e dispatcher.
3. Clique em **Conectar WhatsApp**. O Hub reutiliza `EVOLUTION_INSTANCE_NAME` ou cria a instância quando ausente.
4. No celular, abra WhatsApp → Aparelhos conectados → Conectar aparelho e leia o QR.
5. O polling ocorre a cada 3 segundos por uma janela controlada de até 120 segundos e termina ao conectar, trocar a geração ou expirar. QR expirado exige ação explícita para gerar outro.
6. Depois de conectado, confira o destino mascarado e clique explicitamente em **Enviar mensagem de teste**.

Os endpoints usados na Evolution 2.3.7 são `POST /instance/create`, consulta de conexão da instância, `POST /message/sendText/{instance}` e `POST /message/sendMedia/{instance}`. O gateway envia o PDF como documento em base64, com nome de arquivo e MIME `application/pdf`; não entrega apenas um link. Não coloque a `apikey` em arquivos JSON versionados, no browser ou em logs.

O QR existe somente na resposta transitória da sessão do browser: não entra em SQLite, arquivo, log, evento ou n8n. Logout e exclusão ficam em configurações avançadas e exigem digitar o nome exato da instância. O client sanitiza respostas de erro e nunca devolve a API key ou o alvo integral.

## Recuperação

Consulte a [homologação operacional](operational-homologation-2026-10-13.md)
antes de adotar o override experimental de compatibilidade. `CONNECTED`
indica estado de sessão, não comprovação de recebimento de comandos. O evento
`WHATSAPP_APPROVAL_ANALYZED` registra tempos sanitizados de processamento,
envio e idade da mensagem para investigar atrasos sem guardar a conversa.

- Instância desconectada: gere novo QR; não recrie volumes sem necessidade.
- `401/403`: valide que a mesma chave está no n8n e Evolution, sem imprimi-la.
- Mensagem não chega: confira conexão, número internacional e execuções do workflow.
- API offline: veja Postgres e Redis antes de reiniciar a Evolution.

Não use o comando de remoção de volumes como diagnóstico: ele apaga estado persistente e exigiria reconectar a instância.

## Inbound comunitário V4

O inbound é separado do fluxo de alertas. Evolution 2.3.7 envia somente eventos novos ao endpoint Career autenticado; `MESSAGES_UPSERT` passa por validação de instância, grupo allowlisted, `fromMe`, privado e idempotência antes do detector barato. `MESSAGES_SET` é histórico e ignorado. Nenhum payload bruto ou conversa irrelevante é persistido.

A V4.1 usa os endpoints oficiais `webhook/set` e `webhook/find`, com configuração explícita e header secreto server-side. A retenção operacional no Postgres da Evolution permanece separada da persistência minimizada do Hub. Veja [evolution-webhook-runtime.md](evolution-webhook-runtime.md).

## Aprovação de currículo

O gateway é deliberadamente manual. `POST /api/whatsapp/approvals/prepare` cria uma candidatura `PLANNED` associada à vaga, à versão exata e ao PDF. O envio externo exige uma segunda chamada com confirmação igual ao ID do pedido. Depois do envio, são aceitos `APROVAR ID`, `NEGAR ID` e `ANALISAR ID`. Após `ANALISAR`, `1 ID observação` solicita uma nova revisão pela camada de inteligência e `2 ID` desaprova o currículo, arquiva a versão e encerra a candidatura. Todos os comandos precisam chegar na conversa configurada e pelo remetente autorizado. Em grupo, `CAREER_WHATSAPP_APPROVER` é obrigatório; em conversa privada, o destino é também o aprovador padrão. IDs de mensagens são armazenados apenas como hash para impedir replay.

Novos pedidos usam IDs legíveis no formato `VAGA-123456`. Quando o destino privado é a própria conta conectada, a Evolution marca a resposta como `fromMe` e pode representar a conversa por um LID interno. O gateway aceita esse caso somente quando `remoteJidAlt` corresponde ao destino configurado, incluindo a equivalência brasileira conhecida com ou sem o nono dígito; mensagens próprias para outras conversas continuam bloqueadas.

A imagem instalada expõe uma rota `sendButtons`, mas isso comprova apenas a presença do endpoint, não a entrega interoperável dos botões no cliente WhatsApp conectado. O gateway usa comandos de texto, que são a alternativa confiável prevista para esta etapa.

## Perguntas de formulário

Quando AutoApply para em uma pergunta obrigatória comum, o gateway pode enviar um pedido `PERG-123456`. Se a LLM local entregar uma sugestão não vazia, dentro do tempo e validada pelo EvidenceGuard, ela aparece apenas como sugestão. `USAR PERG-123456` a aprova; `RESPONDER PERG-123456 minha resposta` registra texto do usuário; `PULAR PERG-123456` mantém a pendência no sistema. Depois de uma resposta válida, o orquestrador retoma a mesma candidatura sem repetir um submit já iniciado.

Pedidos e recibos usam tabelas próprias, hash do destino e hash da mensagem para impedir replay. O webhook mantém as mesmas verificações de segredo, instância, conversa e aprovador. Respostas contextuais não entram no banco reutilizável; perguntas sensíveis, demográficas ou de consentimento não são enviadas por WhatsApp.

`APROVAR` move a candidatura para `APPROVED`, confirma a decisão e, quando a faixa configurada autoriza, inicia o AutoApply. A conversa recebe uma segunda confirmação ao final com vaga, provider e estado real: enviado com recibo, bloqueado para revisão, falha anterior ao clique ou envio incerto. `SUBMISSION_UNCERTAIN` nunca dispara nova tentativa automática. `NEGAR` move para `CANCELLED` e confirma o encerramento. `ANALISAR` responde com os links da vaga e do workspace sem alterar o estado. A opção `1` trata a observação como preferência editorial não factual, preserva EvidenceGuard e exige nova revisão; a opção `2` retira a versão da fila ativa sem apagar o artefato mínimo de auditoria.

## Rotação de chave após exposição histórica

Como versões anteriores da Evolution podiam incluir identificadores e metadados sensíveis em logs brutos, trate qualquer `EVOLUTION_API_KEY` que tenha aparecido em histórico de terminal, exportação ou log como comprometida. A rotação operacional deve ser feita sem registrar o valor: gere uma chave longa nova, substitua-a somente no `.env` local, recrie `app`, `n8n` e `evolution-api`, atualize clientes internos que usem a chave e confirme o diagnóstico mascarado. Em seguida, invalide a chave anterior e remova exportações históricas inseguras conforme a política de retenção. Não apague volumes de instância, Postgres ou Redis para rotacionar a chave.
