# Autenticação Gupy observável e apresentação PT-BR

Atualização após retorno de uso: [correção de Fontes e conexões](connections-ux-feedback.md).
Esse complemento substitui a apresentação de contas por empresa e o comportamento
de repetição de tentativas descritos na fase original abaixo; os resultados
históricos de validação continuam identificados como históricos.

## Escopo e causa confirmada

Base `0c214b4`, Node ESM, SQLite nativo, Playwright 1.61.0 e SPA existente. Sem dependências, migrações ou mudanças nas políticas de candidatura, parser/fill, descoberta, evidências, currículos e envio.

A tentativa observada antes desta fase não recebeu claim do auxiliar. A API projetava o simples pedido pendente como `AUTH_IN_PROGRESS`; a UI abria um protocolo Windows sem confirmação ou recuperação persistente; sem jobId, o destino era a primeira vaga Gupy. Não há evidência suficiente para atribuir aquele clique a um erro específico do Windows. Agora a ausência de confirmação é um resultado explícito, não um login fictício.

## Estados e recuperação

| Evento comprovado | Estado interno | Apresentação |
| --- | --- | --- |
| Pedido criado | LAUNCH_PENDING | Aguardando abertura da janela de login |
| Auxiliar confirmou claim | AUTH_IN_PROGRESS | Login em andamento |
| Contexto visível aberto | USER_ACTION_REQUIRED | Conclua o login na janela da Gupy |
| Estado recebido para verificação | SESSION_VALIDATING | Verificando sua sessão |
| Verificação positiva concluída | SESSION_ACTIVE | Conta Gupy conectada |
| Sessão venceu | SESSION_EXPIRED | Sua sessão expirou |
| Pedido venceu | AUTH_REQUEST_EXPIRED | Sua tentativa de login expirou |
| Auxiliar não iniciou | AUTH_LAUNCH_FAILED | Não foi possível abrir a janela de login da Gupy. |
| Janela/validação falhou | AUTH_FAILED | Não foi possível concluir o login da Gupy. |

Prazos aplicados na leitura/poll: abertura 20 s, lease sem heartbeat 30 s, validação 45 s, pedido dez minutos. Navegação do auxiliar tem timeout de 20 s, menor que o lease. Datas e falhas sanitizadas usam `payload_json` existente. Callbacks atrasados, replay e eventos fora de ordem não podem concluir pedidos terminais. Sessão removida/expirada não é restaurada como conectada.

Na tela geral, **Conectar conta Gupy** cria um pedido central sem exigir empresa. Um `jobId` explícito ainda preserva host/empresa quando a reautenticação parte de uma candidatura. A sessão autenticada pertence à conta Gupy e pode ser reutilizada entre empregadores; o acesso ao portal de cada empresa continua sendo validado separadamente durante a preparação. Abrir/recarregar a página é leitura local e não consulta portais.

O auxiliar reporta claim, abertura, heartbeat e falha tipada. PowerShell reporta ausência de Node e falhas de inicialização mesmo com janela oculta. Se o processo morrer sem conseguir avisar, o lease termina a espera. O fallback **Ver como resolver** oferece execução direta do script com autorização temporária, além da verificação/reparação explícita do registro. Não é apenas outro botão para o mesmo protocolo.

## Apresentação

`public/app/presentation.js` contém dicionários por domínio: auth, application, resume, evidence, opportunity, source, connection, observability e common. `humanLabel`, `humanError`, `humanText` e datas PT-BR são usados pelas telas existentes. Erros HTTP preservam `.code` e status; códigos não mapeados recebem orientação em português. Os valores enviados à API, enumerações, SQL, filtros, políticas e exportações não são traduzidos.

Exemplos:

- `AUTH_REQUIRED` → Entre na Gupy para continuar.
- `PREPARATION_REQUIRED` → Prepare o currículo desta vaga.
- `NOT_INDEXED` → Repositórios ainda não analisados.
- `STRETCH` → Oportunidade de desenvolvimento. “Você atende parte importante da vaga, mas existem lacunas relevantes.”

Currículos em lote, candidaturas em lote, verificação das evidências, versão do currículo, compatibilidade técnica e confiança da análise substituem jargões nas apresentações alteradas. Compatibilidade, cobertura de evidências, confiança, prioridade, preparação e autorização continuam conceitos separados. IDs continuam em links/atributos/detalhes técnicos, não como título principal da versão.

Níveis de log, estados e datas são apresentados em português; filtros mantêm seus valores originais. Datas de filtro usam controles locais e são convertidas para ISO ao consultar. Diagnósticos brutos permanecem em detalhes expansíveis e no TXT sanitizado.

## Limites de tradução

Não se traduzem nomes de fornecedores, tecnologias, nomes de arquivos, títulos/descrições importados de vagas ou texto escrito pelo candidato. Filtros avançados e diagnósticos preservam códigos internos. Painéis legados de configuração técnica ainda podem conter nomes de ferramentas e termos como adapter, endpoint, runtime ou Search Composer; não foram redesenhados. Novos códigos sem dicionário mostram fallback em português, sem prometer tradução universal de conteúdo arbitrário do backend.

## Validação

Testes: `source-auth-lifecycle`, `gupy-auth-frontend`, `presentation-pt-br`, `connections-observability`, `connections-observability-frontend`, `application-batch-frontend`, `resume-batch-frontend`, jornadas `experience-v2` e integração. Fixtures não consultam provedores reais nem enviam credenciais.

- Focados de autenticação/apresentação: 58/58; jornadas: 10/10; navegação direcionada: 1/1. Conjuntos sobrepostos, não somar como testes únicos.
- Uma suíte completa: 878/883, cinco falhas, 364835 ms. Três expectativas antigas de texto; duas verificações de overflow. Reexecução dos conjuntos afetados após correções: 78/78, 85412 ms. Revisão final da apresentação comunitária: 5/5. Não foi executada uma segunda suíte completa e não se declara 883/883.
- Rótulos longos passaram a quebrar linha; cartões/indicadores usam trilhas que podem encolher em telas menores. Cores e componentes preservados. O diagnóstico de overflow foi mantido nas asserções para facilitar regressões futuras.
- Sintaxe: 379 JS/ESM aprovados, mais verificação do último ajuste de texto; parser PowerShell sem erros. Python não foi alterado.
- SQLite real via contêiner: integrity_check=ok, foreign_key_check=0; aplicações/tentativas/comprovantes/SUBMITTED=0. Flags de envio e inspeção ao vivo false. Dois históricos de busca e um lote/rascunho anterior preservados.
- Exportações TXT filtrada/completa: HTTP200, sem padrões de chave privada, bearer de handoff ou ticket bruto nas verificações executadas.
- Imagem final: app e career-engine saudáveis; hashes de 25 arquivos de produção iguais aos locais. Três builds do app durante a fase, necessárias após ajustes de fonte; engine não foi reconstruído. Na última, warm-up Tectonic ficou CACHED e preparação de recursos levou 12,1 s. Cache de build permanece dívida técnica, sem redesenho.
- Varredura final de padrões de segredos: 40 arquivos, zero ocorrências; nenhum `.env`, arquivo temporário ou Python alterado. `git diff --check` aprovado.

### Pendência de homologação humana

O protocolo Windows e a abertura do Chrome normal com perfil temporário foram comprovados. Em uma tentativa manual, o login chegou à página central de candidaturas da Gupy. Probes sanitizados demonstraram que somente cookies seguros compartilhados de `.gupy.io` restauram essa página; o sistema não importa o perfil pessoal do navegador nem persiste storage de origem.

O runner, a detecção positiva e o segundo probe no contêiner foram ajustados a partir dessa evidência. Na tentativa posterior às correções finais, a janela permaneceu na tela de login e foi encerrada sem autenticação; nenhum estado foi salvo. Assim, ainda falta concluir uma nova autenticação humana e comprovar `SESSION_ACTIVE`, cofre, refresh, restart e revalidação no fluxo final.

Ao repetir, abrir `/connections?jobId=<id da vaga Gupy>`, conferir a empresa e clicar **Entrar na Gupy**. Não compartilhar senha, ticket ou o comando temporário. Uma conta ativa não equivale a acesso já verificado para toda empresa; essa verificação ocorre ao preparar a vaga. Nenhuma candidatura é preenchida ou enviada nesta fase. Dívida de cache de build Docker permanece fora do escopo.
