# Currículo específico → aprovação WhatsApp → AutoApply

## Fluxo

Para oportunidades que passam pelos limiares configurados, o Job Hunt:

1. executa o matcher e a política de oportunidade;
2. gera tailoring factual com o provider local configurado;
3. aprova automaticamente apenas changesets com `EvidenceGuard` válido;
4. cria uma `ResumeVersion` específica para a vaga;
5. renderiza e valida o PDF;
6. envia o PDF ao destino WhatsApp autorizado;
7. aguarda `APROVAR <ID>`, `NEGAR <ID>` ou `ANALISAR <ID>`;
8. após aprovação, inicia o adapter correspondente ao `applicationUrl` real.

Se o formulário encontrar uma pergunta obrigatória desconhecida, o fluxo tenta produzir uma sugestão factual com a LLM local por um orçamento curto. Sugestão vazia, fallback, timeout ou violação de evidência não bloqueia a candidatura: o gateway envia a pergunta com `RESPONDER PERG-<ID> <resposta>` e `PULAR PERG-<ID>`. Quando existir sugestão válida, `USAR PERG-<ID>` funciona como aprovação explícita; rascunho da IA nunca é preenchido sem essa aprovação. A resposta é persistida na pergunta da candidatura e o mesmo AutoApply é retomado com nova chave idempotente. Perguntas demográficas, sensíveis e consentimentos permanecem somente no workspace da candidatura.

Busca específica e oportunidades adicionadas por link reutilizam os passos 6 a 8 quando o usuário aprova e renderiza uma `ResumeVersion` específica da vaga. A origem da descoberta não cria um segundo orquestrador: todos os caminhos usam o mesmo pedido idempotente, o mesmo gateway e a mesma candidatura persistida.

## AutoApply por nota ATS

A tela Automação permite ativar uma política global e configurar três limites: nota de AutoApply (80 por padrão), início da faixa WhatsApp (60) e fim da faixa WhatsApp (79). A política nasce desligada. Quando ligada, uma versão específica `READY`, com PDF validado, qualidade `PASS` e nota igual ou superior a 80 pula o WhatsApp e inicia o mesmo `AutoApplyOrchestrator`; destinos homologados podem seguir até o AutoSubmit. Notas entre 60 e 79 exigem revisão no WhatsApp. Notas abaixo de 60 ficam em Candidaturas para análise dentro da plataforma. Mass Hunt, busca específica e vaga adicionada por link seguem a mesma regra. Itens com alerta editorial continuam pedindo aprovação humana independentemente da nota.

O limite é uma autorização permanente para iniciar o fluxo, não uma remoção dos gates. A dispensa do WhatsApp exige um tailoring run vinculado à versão, EvidenceGuard `VALID` e qualidade `PASS` com `autoApplyEligible=true`; apenas nota ATS alta não basta. Elegibilidade, bloqueios materiais, disponibilidade, sessão autenticada, compatibilidade do formulário, preflight, idempotência e `CAREER_SUBMISSION_ENABLED` continuam obrigatórios. Portais sem adapter de envio permanecem em revisão ou encaminhamento manual.

Falha do LM Studio/Ollama, compilador, Evolution ou WhatsApp não cria candidatura fictícia nem perde a vaga. O alerta permanece observável e o envio do pedido pode ser retomado. Uma notificação simples do n8n não marca o pedido de PDF como concluído.

O Mass Hunt é a autoridade das suas entregas: callbacks de renderização de versões `MASS_HUNT_AUTOAPPLY` não disparam um segundo envio fora de quiet hours, pausa e orçamento. A busca agendada reutiliza esse mesmo serviço, targets e limites efetivos. A nota global pode baixar o piso preliminar de preparação, mas nunca remove os gates editoriais ou obriga a preparar quando a opção estiver desligada.

Pedidos de PDF adiados ou com falha transitória têm retomada limitada no timer. Perguntas `PREPARED` podem reenviar sem gerar outra sugestão; escalonamentos simultâneos compartilham a mesma execução. A falha de uma confirmação textual não impede a retomada de um handoff. Confirmações de decisão/resultado ainda não possuem outbox próprio de retry durável: falhas são registradas, e um novo comando de decisão recebe confirmação sem repetir a transição. O orçamento curto da sugestão libera o fallback WhatsApp, mas o cancelamento da inferência subjacente depende do cliente LLM.

## Autoridade da aprovação

Antes de abrir o formulario, o AutoApply consulta a disponibilidade publica
atual pelo servico existente. Encerramento confirmado cancela a candidatura
nao enviada, preserva PDF/historico e notifica no WhatsApp "Vaga encerrada no
portal" com a vaga e o link. Timeout, bloqueio ou resposta inconclusiva deixam
a candidatura aguardando verificacao, sem declarar expiracao e sem preencher.
O preflight manual tambem bloqueia vagas ja marcadas CLOSED. Idade de 30 dias
nao e prova de encerramento. A checagem publica nao substitui a revalidacao
autoritativa do adapter imediatamente antes do submit.

O aviso generico ADAPTER_UNSUPPORTED_LAYOUT de uma tentativa anterior nao e
retroativamente reescrito. Quando o encerramento e identificado depois,
uma correcao explicita pode ser enviada, sem reproduzir a aprovacao ou tentar
preencher de novo. Candidaturas enviadas/incertas ou com submit em andamento
nao sao canceladas durante a espera da verificacao HTTP.

O pedido é ligado a uma candidatura, vaga, versão imutável do currículo, artefato PDF e destino WhatsApp. O webhook exige segredo, instância, conversa e remetente autorizados. A aprovação inicia o fluxo, mas não ignora preflight fresh, respostas obrigatórias, autenticação, challenge, idempotência ou confirmação externa.

`ANALISAR <ID>` devolve um deep link para a vaga e dois comandos vinculados ao mesmo pedido. `1 <ID> <observação>` enfileira um novo tailoring e confirma tanto o recebimento quanto a disponibilidade dos ajustes para revisão. `2 <ID>` desaprova a versão, remove-a da fila ativa e cancela a candidatura; o artefato mínimo permanece preservado para auditoria. Aprovação, negação e conclusão do AutoApply sempre geram confirmação na conversa. Somente recibo confirmado produz a mensagem de candidatura enviada.

Repetições usam a identidade estável `whatsapp-autoapply:<approvalRequestId>:<provider>`. Estado incerto após clique nunca recebe retry cego.

## Roteamento atual

| Destino da candidatura | Comportamento após `APROVAR` |
| --- | --- |
| Greenhouse | preenche, valida e usa Controlled Submit quando `CAREER_SUBMISSION_ENABLED=true` em produção |
| Gupy | cria/reutiliza Application Batch, usa sessão autorizada, preenche, valida e submete quando habilitado |
| Lever | preenche, valida e usa Controlled Submit quando `CAREER_SUBMISSION_ENABLED=true` em produção |
| Ashby | preenche, valida e usa Controlled Submit quando `CAREER_SUBMISSION_ENABLED=true` em produção |
| SmartRecruiters e Workable | preenche, valida e usa Controlled Submit quando `CAREER_SUBMISSION_ENABLED=true` em produção |
| Nerdin | prioriza ATS externo quando houver; no formulário público nativo usa Controlled Submit com três etapas, currículo exato, consentimento e recibo |
| IEL, Sólides, Recrutei, ProgramaThor e Remotar | prioriza o CTA público e roteia pelo `applicationUrl`; se o destino continuar nativo, usa preenchimento assistido e conclusão manual |
| Abler, Quickin e Pandapé | destino reconhecido e preenchimento assistido; autenticação/identificação e envio final permanecem handoff até homologação individual |
| InfoJobs, Vagas.com.br, Catho e GeekHunter | quando chegam por URL pública, usam preenchimento assistido e conclusão manual |
| Indeed, LinkedIn, Glassdoor, Google Jobs e páginas de empresa | resolvem o destino final; usam o adapter do ATS encontrado ou preenchimento assistido genérico |
| Workday | preenche a etapa corrente e faz handoff em autenticação/transição; envio final manual |
| Destino desconhecido | handoff explícito; nenhum preenchimento ou envio é alegado |

Os destinos assistidos também participam do fallback de perguntas por WhatsApp. Depois que as respostas ficam completas, eles chegam a `READY_TO_SUBMIT_MANUAL` e o gateway envia o deep link da candidatura e o link do portal; não há clique final automático sem adapter dedicado, revalidação fresca e confirmação positiva.

`CAREER_SUBMISSION_ENABLED=false` mantém todo o caminho de currículo, WhatsApp e preenchimento, mas bloqueia o clique final. Antes de armar o clique em um ATS de Controlled Submit, o transporte confirma que o arquivo anexado no formulário tem o mesmo SHA-256 do PDF da versão selecionada. Upload ausente ou diferente bloqueia antes da ação. Login, MFA, CAPTCHA, pergunta obrigatória desconhecida, formulário divergente e vaga não confirmada continuam como paradas concretas.

O resolver preserva duas identidades: `sourceUrl` registra onde a vaga foi encontrada e `applicationUrl` registra onde a candidatura realmente acontece. Resolver um destino ou preencher campos não concede permissão de envio: somente o capability registry pode autorizar Controlled Submit.

## Operação

O runtime precisa de:

- provider local e modelo configurados em Configurações → Inteligência;
- compilador PDF disponível no container/runtime;
- Evolution conectada, destino e aprovador configurados;
- webhook inbound com segredo;
- `CAREER_SUBMISSION_ENABLED=true` apenas no ambiente que executará o clique final.

O banco aplica migrations aditivas no startup. A migration 31 cria o gateway de aprovação, a migration 42 adiciona as faixas de nota e a migration 44 persiste pedidos e recibos idempotentes de perguntas de formulário.
