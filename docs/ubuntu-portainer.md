# Ubuntu, Portainer e Tailscale

## Estado desta entrega

Preparacao para Docker **Standalone**, nao Swarm. A stack dedicada e
`compose.portainer.yaml`. A configuracao local `compose.yaml` nao mudou.
A preparacao de codigo/imagens nao inicia a stack nem altera automaticamente
os dados ou servicos existentes. Build local ou validacao do YAML nao comprovam
funcionamento no Ubuntu de destino.

O ZIP de auditoria inclui codigo, testes, migrations, documentacao e exemplos.
Nao inclui banco, curriculos pessoais, `.env`, chaves ou sessoes: **nao e um
backup operacional nem uma migracao dos dados atuais**.

O exportador usa caminhos POSIX dentro do ZIP, inclusive quando executado no
Windows. Pacotes antigos com barras invertidas nao devem ser usados no Linux:
gere novamente e confira os hashes apos extrair no destino. O validador atual
rejeita esse formato nao portavel em vez de normaliza-lo silenciosamente.

## Antes de implantar

- Confirmar usuario SSH, chave local/Tailscale SSH, URL e versao do Portainer,
  arquitetura, CPU, RAM, armazenamento livre e versoes Docker/Compose.
- Confirmar o checkout `frontend/redesign-v3`, nao `main`, e anotar o commit.
- Confirmar a policy Tailscale: so o proprietario/dispositivos autorizados
  devem acessar o Hub. A VPN nao substitui essa autorizacao.
- Usar `/srv/tsf/source` para codigo e `/srv/tsf/data` para dados persistentes.
  O bind de dados exige que a pasta exista; nao cria silenciosamente uma base vazia.
- Nao executar a automacao em dois servidores com a mesma conta WhatsApp.
- Nao habilitar envio ao empregador antes da homologacao no novo host.

## Imagens e stack

A stack usa imagens prontas no **mesmo Docker gerenciado pelo Portainer**,
sem depender de caminhos relativos do checkout dentro do container Portainer.
Alternativamente, publique imagens em registry privado e ajuste a politica
de pull; nao publique imagens com dados pessoais.

O servidor informado ja tem um n8n acessivel em `5678`. Nao remover nem
substituir essa instalacao. A stack proposta cria um n8n isolado, inicialmente
sem workflows ativos, em loopback `15678`, e Evolution em `18081` para evitar
conflitos. Antes de ativar automacoes, decidir entre migrar o n8n atual ou
integrar o TSF a ele pela rede Docker; nao ativar os mesmos fluxos nos dois.

Depois de transferir o codigo, no Ubuntu:

```sh
cd /srv/tsf/source
git branch --show-current
git rev-parse HEAD
TSF_RELEASE=$(git rev-parse --short=12 HEAD)
TSF_REVISION=$(git rev-parse HEAD)
docker build --build-arg "TARGETARCH=$(dpkg --print-architecture)" --build-arg "TSF_REVISION=$TSF_REVISION" -t "tsf-career-app:$TSF_RELEASE" .
docker build --build-arg "TSF_REVISION=$TSF_REVISION" -t "tsf-career-engine:$TSF_RELEASE" ./engine
docker build -t "tsf-evolution-compat:$TSF_RELEASE" ./docker/evolution-compat
```

Para codigo extraido do ZIP sem `.git`, obtenha o commit em
`AUDIT_CHECKSUMS.json` e defina `TSF_RELEASE` manualmente com esse identificador.
Defina tambem `TSF_REVISION` com o commit completo do manifesto. Verifique a
label `org.opencontainers.image.revision` nas imagens antes do deploy.
O Dockerfile espera `data/.gitkeep`; ele esta incluido no pacote, nao os dados.

No Portainer: **Stacks > Add stack**, nome `tsf-production`, cole
`compose.portainer.yaml` e configure as variaveis no ambiente da stack:

| Variavel | Valor |
| --- | --- |
| `TSF_APP_IMAGE` | `tsf-career-app:<release>` |
| `TSF_ENGINE_IMAGE` | `tsf-career-engine:<release>` |
| `TSF_EVOLUTION_IMAGE` | `tsf-evolution-compat:<release>` |
| `TSF_DATA_DIR` | `/srv/tsf/data` |
| `CAREER_PUBLIC_URL` | URL HTTPS privada configurada no Tailscale Serve |
| `CAREER_SUBMISSION_ENABLED` | `false` na implantacao inicial |
| `CAREER_N8N_WEBHOOK_SECRET` | Segredo aleatorio exclusivo |
| `CAREER_EVOLUTION_WEBHOOK_SECRET` | Outro segredo aleatorio exclusivo |
| `EVOLUTION_API_KEY` | Outro segredo aleatorio exclusivo |
| `N8N_ENCRYPTION_KEY` | Chave permanente; preservar se migrar o n8n existente |
| `EVOLUTION_POSTGRES_PASSWORD` | Senha aleatoria hexadecimal, segura na URI |
| `EVOLUTION_INSTANCE_NAME` | Nome da instancia atual ou nova deliberadamente |
| `CAREER_WHATSAPP_TARGET` | Destino revisado antes de ativar alertas |
| `CAREER_WHATSAPP_APPROVER` | Seu remetente autorizado |

Gere cada segredo novo separadamente com `openssl rand -hex 32`. Nunca cole
os valores no chat ou Git. Administradores do Docker/Portainer conseguem ler
variaveis de ambiente; mantenha acesso administrativo restrito.

O caminho do `.env` local nao e importado automaticamente pelo editor da
stack. A stack nao precisa de `profiles`, `build` nem de montar repositorios
vizinhos em `/legacy`. Os servicos Python, Postgres e Redis nao publicam portas.
Os volumes nomeados pertencem ao nome da stack: nao renomear/remover volumes
durante atualizacoes. O workflow n8n pode ser importado de
`automation/n8n/workflows/career-whatsapp-alerts.json`; ative-o somente depois
de revisar URLs internas e segredos, conforme `automation/n8n/README.md`.

## Acesso privado

A imagem `docker/evolution-compat` fixa Baileys7rc13 em `/opt/tsf-baileys`,
com link para o modulo esperado pela Evolution. A instalacao fica separada da
arvore antiga do projeto: nao faz reify/remocao global das dependencias da
Evolution. O build exige importacao do modulo a partir de `/evolution` e valida
o patch e a sintaxe dos bundles, sem iniciar uma instancia WhatsApp.

Todas as portas publicadas ficam em `127.0.0.1` do Ubuntu. Portanto,
`http://100.x.y.z:7123` **nao** abre diretamente; isso e intencional.
Se o servidor nao tem outro Serve configurado, apos revisar a configuracao:

```sh
tailscale serve status
sudo tailscale serve --bg --https=443 http://127.0.0.1:7123
```

Use a URL `.ts.net` exibida pelo comando como `CAREER_PUBLIC_URL` e faca o
redeploy da stack se necessario. Nao usar Funnel nem abrir portas na internet.
Nao sobrescrever um Serve ja usado por outros servicos sem revisar antes.

Para mobile Android0.3, que aceita origem sem porta explicita, mantenha web em
443 e adicione o mount `/api/mobile/v1` para
`http://127.0.0.1:7125/api/mobile/v1`:

```sh
tailscale serve --bg --https=443 --set-path=/api/mobile/v1 http://127.0.0.1:7125/api/mobile/v1
```

Defina
`MOBILE_GATEWAY_ENABLED=true` e os usuarios exatos em
`MOBILE_GATEWAY_ALLOWED_TAILSCALE_USERS`. Nao publicar esse gateway
diretamente: ele confia nos headers de identidade do Tailscale Serve.
Confira tambem o IP exato do proxy. Em manutencao, o app conecta somente para
consultas; comandos continuam bloqueados. Consulte [gateway mobile](mobile-gateway.md).
Administracao n8n/Evolution pode usar tunel SSH em vez de exposicao publica.
O n8n exige cookie seguro nesta stack: para o navegador remoto, configurar
HTTPS privado dedicado e suas URLs de editor/webhook antes de utiliza-lo.
Nao desativar cookie seguro para contornar uma configuracao HTTPS incompleta.

O workflow `.github/workflows/deploy-local.yml` existente e legado: usa
`main`, runner Windows e caminho antigo. Nao instala nem atualiza esta stack
Linux; nao habilita-lo para tentar implantar `frontend/redesign-v3` no servidor.

## Migrar os dados privados: etapa separada

Antes de mover dados, parar agendas/filas de forma controlada, fazer backup
SQLite consistente e verificar `integrity_check`/`foreign_key_check`.
Nao copiar apenas o `.sqlite` de um processo ativo ignorando WAL/SHM.

Preservar juntos banco, artefatos de curriculo, credenciais cifradas e a chave
`source-credentials.key` do volume atual. Sem a chave correspondente, as
sessoes/tokens cifrados nao podem ser recuperados. Manter tambem a chave de
criptografia n8n e backups separados de Postgres, Redis e Evolution.

Revisar caminhos absolutos Windows em `storagePath`/configuracoes antes de
restaurar no Linux; validar BASE 01 e PDF anexado pela interface. Nao copiar
as pastas `node_modules` ou perfis normais do Chrome. O pareamento WhatsApp
deve ser migrado com cuidado ou refeito, sem duas instancias concorrentes.
O auxiliar de login dos Cofres roda no computador do usuario; homologar o
handoff/retorno remoto antes de depender dele no servidor sem interface grafica.

A URL `host.docker.internal` agora aponta para o Ubuntu, **nao para seu PC**.
Para usar LM Studio/Ollama do PC, configurar no sistema a URL Tailscale desse
PC e restringir o servidor LLM/firewall a origem autorizada. Nao abrir a porta
da LLM na internet. Com PC/LLM offline, conferir o fallback de textos locais.
O transporte exige tambem `CAREER_LLM_ALLOWED_ORIGINS` com a origem VPN exata
do PC, incluindo protocolo e porta. Veja [perguntas com prazo e preflight](delayed-questions-server-preparation.md).

Antes de iniciar o Hub, ensaie as migrations somente numa copia com
`node scripts/prepare-data-upgrade.mjs <banco-original> <pasta-nova>`.
O auxiliar nao substitui o backup conjunto de PDFs, cofre, chave e canais.
Depois de restaurar, execute `scripts/production_preflight.py` com a flag de
envio explicitamente `false`. Agenda legada ativa e schema antigo sao bloqueios
para revisar, nao motivos para iniciar automaticamente a stack.

## Homologacao e retorno

- Todos os containers saudaveis; migrations sem erro; memoria/disco medidos.
- Abrir o Hub pelo celular/Tailscale; conferir BASE 01 e PDFs reais.
- Agendas inicialmente desligadas; uma busca manual, deduplicacao e ranking.
- Verificar disponibilidade de vaga aberta e encerrada.
- Gerar um curriculo e validar `STATUS`/`ANALISAR`/pergunta real no WhatsApp.
- Validar sessao Cofre, pergunta humana, anexo e recibo em UMA candidatura.
- Somente depois habilitar politicas/agendas desejadas; manter pendencias
  por portal explicitas, sem chamar assistido de AutoSubmit homologado.
- Observar operacao prolongada e logs rotativos antes de declarar autonomia 24h.

Para retorno: parar apenas a stack nova, restaurar dados/volumes consistentes
e imagens da release anterior. Nao executar `down -v`, nao reutilizar banco
migrado com versao antiga sem backup compativel e nao apagar a instalacao do PC.

Referencias oficiais: [Stacks no Portainer](https://docs.portainer.io/user/docker/stacks/add)
e [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve).
