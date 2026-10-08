# Fontes e conexões: correção do retorno de uso — 28/08/2026

## O que foi constatado

Os registros locais contêm sete tentativas para Fin-X entre 21:20:32 e 21:20:42 UTC.
Seis foram canceladas por novas tentativas; a última terminou em
LAUNCH_NOT_ACKNOWLEDGED. Nenhuma registrou confirmação do auxiliar, abertura
da janela ou comunicação periódica. Não foi uma rejeição da senha pela Gupy.

O botão era desabilitado apenas durante o pedido HTTP e reabilitado no finally,
mesmo com a abertura ainda pendente. Cada novo clique enviava force=true, e o
servidor cancelava a tentativa anterior, invalidando sua autorização temporária.

O registro do protocolo no Windows e a execução do auxiliar foram verificados
com um servidor local isolado que rejeitava a autorização: chamada direta em
824 ms; pelo protocolo registrado em 1.215 ms. Não houve acesso externo nem
abertura de conta nesse teste. A cadeia Windows/PowerShell/Node funcionou.
Nos registros reais, o pedido não chegou ao auxiliar. Não foi possível provar
qual regra, aviso ou permissão do navegador impediu esse encaminhamento.

## Correção da interação

- O clique altera o botão para “Abrindo…” com indicador visual antes de aguardar
  a resposta. Um bloqueio local impede pedidos repetidos, inclusive eventos
  disparados enquanto a resposta está atrasada.
- O bloqueio permanece durante abertura, autenticação e validação. A seleção
  da empresa, a verificação e a desconexão ficam protegidas nessa tentativa.
- A API preserva a tentativa ativa mesmo quando outro cliente envia force=true.
  Uma falha de um segundo auxiliar que não conseguiu assumir a tentativa não
  pode cancelar o auxiliar já responsável por ela.
- “Autorizar abertura da janela” é um acesso direto, acionado pelo usuário,
  que continua a mesma tentativa quando o navegador não permite abertura
  automática. Não cria outro pedido. Novos cliques nesse acesso são bloqueados.
- Uma falha temporária ao consultar o estado não desbloqueia outra abertura:
  a consulta continua. Falha terminal permite tentar novamente.
- Recarregar restaura o estado, não o segredo temporário. O prazo de abertura
  continua em 20 segundos; não há espera pendente ilimitada.
- A conclusão atualiza a árvore visível e remove instruções de recuperação
  que não se aplicam à conexão concluída.

## Uma conta, não várias

A [orientação oficial da Gupy](https://www.gupy.io/blog/atualizar-cadastro-gupy)
descreve uma conta de candidato com acesso a processos de diferentes empresas.
A tela anterior misturava isso com o isolamento de sessões adotado por este
aplicativo.

O retorno de uso posterior simplificou esses objetivos:

1. “Conectar conta Gupy” inicia diretamente a conexão assistida em perfil
   temporário isolado, sem exigir empresa.
2. “Preparar candidaturas no aplicativo” escolhe a empresa da vaga somente
   depois; o acesso à página correspondente é validado nessa etapa.

O atalho externo para abrir a conta no navegador cotidiano foi removido da ação
principal porque não autoriza o aplicativo e competia visualmente com o fluxo real.

A lista recolhida agora se chama “Acesso às empresas” e comunica que essa
verificação acontece ao preparar. A sessão cifrada continua sendo da conta
Gupy; isso não declara acesso universal antecipado às páginas das empresas.

## Organização e português

Cartões com borda, fundo, espaçamento e títulos distintos; grupos por finalidade;
áreas separadas para conta e candidatura; estados próximos da ação; controles
com foco visível e indicador que respeita redução de movimento. A disposição
se adapta a celular, tablet e computador, preservando os recursos existentes.

Descrições principais foram substituídas por português claro. Exemplos:
tenant → página da empresa; discovery → busca de vagas; login → autenticação;
postings e Job Board → vagas publicadas. A apresentação dos estados foi
traduzida sem alterar códigos enviados à API. Nomes de fornecedores, endereços,
comandos executáveis e identificadores em detalhes técnicos continuam exatos.

## Verificação e limites

Conjunto direcionado: 68/68 testes aprovados. Inclui autenticação, segurança das
rotas e sessões, apresentação PT-BR, cache, candidaturas e currículos em lote.
As larguras 390, 768 e 1366 foram verificadas em páginas de teste isoladas;
capturas locais estão em tmp/connections-feedback. Não foi executada novamente
a suíte completa do projeto nesta correção.

As verificações simuladas não equivalem a autenticação real. A ferramenta de
navegador havia bloqueado a página real por política; esse bloqueio não foi
contornado. O usuário ainda precisa confirmar a abertura no navegador e entrar
na conta, sem compartilhar senha, autorização temporária ou dados de sessão.
Nenhum preenchimento, envio de candidatura ou busca externa foi iniciado.

### Fechamento da entrega

- Após o último ajuste de apresentação da conexão concluída, a jornada Gupy
  foi reexecutada: 1/1, incluindo as três larguras e a ausência de recuperação
  indevida no estado conectado. Sintaxe final: 379 arquivos JS/ESM aprovados.
- Uma reconstrução do aplicativo e uma recriação do seu contêiner. Aplicativo
  e motor de vagas saudáveis, respostas locais HTTP 200. Os quatro arquivos de
  produção alterados têm os mesmos hashes no computador e na imagem em uso.
  O motor e os serviços de automação não foram reconstruídos.
- Banco real: integrity_check=ok; foreign_key_check=0. Aplicações, tentativas
  e comprovantes continuam em zero. Dois históricos de busca e um rascunho/lote
  preexistente preservados. CAREER_SUBMISSION_ENABLED=false; LIVE_INSPECT=false.
- Exportação de diagnóstico local: HTTP 200. Nenhuma credencial foi solicitada
  ou publicada. A tentativa real anterior permanece como abertura não confirmada;
  ela não foi substituída por uma falsa conexão ativa.
- A preparação de recursos da imagem levou 12 segundos; Tectonic foi reutilizado
  do cache. Nenhum redesenho de construção Docker foi incluído.
- Alterações mantidas no diretório de trabalho; não houve novo commit ou envio
  ao repositório remoto nesta correção.
- Verificação do diff sem erros e varredura direcionada de padrões de credenciais
  sem ocorrências. A exportação de diagnóstico também passou pela checagem de
  chaves privadas, autorizações temporárias e credenciais de acesso.
