# Discovery V4.1 — preflight de verdade funcional

Data do levantamento: 2026-08-22. Este documento registra o estado encontrado antes das correções da V4.1. `CLAIM` descreve o que a interface ou a documentação sugeria; as demais colunas registram o caminho realmente comprovado no código e nos testes existentes.

| # | Capacidade | CLAIM | BACKEND | PROVIDER REAL | OUTPUT REAL | TESTE ANTES DA V4.1 | PROBLEMA CONFIRMADO | CORREÇÃO V4.1 |
|---:|---|---|---|---|---|---|---|---|
| 1 | Job Board routing | Classe selecionável | `DiscoveryV4Service.run` | JobSpy | Busca leve | Genérico V4 | Compartilhava um único resultado entre classes | Rota explícita para JobSpy |
| 2 | Structured ATS routing | Classe selecionável | `DiscoveryV4Service.run` | JobSpy | Busca leve | Ausente | Greenhouse, Lever, Ashby e SmartRecruiters não eram chamados | Rotear somente boards configurados ao provider correspondente |
| 3 | Official Career Page routing | Classe selecionável | `DiscoveryV4Service.run` | JobSpy | Busca leve | Ausente | Company Radar/career-page não era chamado | Consultar alvos monitorados e reportar ausência de alvo |
| 4 | Public Web routing | Brave quando configurado | `BraveSearchProvider` | Brave | Leads e sinais | Parcial | Variável não chegava ao container `app` | Propagar env e manter segredo apenas no servidor |
| 5 | Community routing | Backlog allowlisted | Repositório V4 | SQLite local | Leads/sinais existentes | Parcial | Status dependia apenas da Evolution, não da ingestão realmente configurada | Diagnóstico composto e consulta honesta do backlog |
| 6 | Test Search | Busca econômica | `jobHuntService.testSearch` | Providers do perfil | Amostra normalizada | Existente | V4 forçava JobSpy | Preservar caminho leve com roteamento por classe |
| 7 | Mass Hunt | Pipeline completo | `DiscoveryV4Service.run` | JobSpy | Amostra maior | Ausente | Chamava `testSearch` com budget maior | Reutilizar o pipeline integral do Job Hunt |
| 8 | Diferença Test/Mass | Ações distintas | Mesmo método | Mesmo provider | Só variava quantidade | Ausente | Sem diferença de domínio | Teste não persiste; Mass executa descoberta, dedupe, filtros e matching |
| 9 | Threshold considerar | Operacional | Job Hunt | N/A | Filtra score | Parcial | Não refletido no funil V4 | Contador event-driven |
| 10 | Threshold preparar currículo | Operacional | Job Hunt | N/A | Prepara versão para revisão | Parcial | Não aceito pela V4 | Normalizar e encaminhar ao pipeline |
| 11 | Threshold notificar | Operacional | Job Hunt | N/A | Enfileira alerta | Parcial | Não aceito pela V4 | Normalizar e encaminhar ao pipeline |
| 12 | Threshold prioridade | Operacional | V4 | N/A | Sempre zero | Ausente | Não aplicado | Aplicar ao score de prioridade e ao funil |
| 13 | Funil Mass Hunt | Contadores auditáveis | Métricas V4 | Múltiplos | Nove contadores | Ausente | Sem `filteredOut`, `matchEvaluated`, `needsReview`, `risky` e `errors` | Funil canônico com 17 campos |
| 14 | Catálogo Job Family | Seletor humano | Catálogo backend existe | N/A | IDs no payload | UI V3 parcial | Composer V4 tinha texto livre e duplicava a semântica | Expor catálogo canônico e usar multiselect |
| 15 | Search Composer | Intenção estruturada | Search Intent V3 | N/A | Queries e JSON bruto | E2E superficial | Resultado primário era JSON | Resumo humano e detalhes técnicos recolhidos |
| 16 | UNKNOWN no matcher | Sem evidência não é falha | `evidenceStrengthMatch` | N/A | `NO_MATCH` | Ausente | Ausência de skill/tool/cert virava negativa | Retornar `UNKNOWN`, reduzir confiança sem zerar score |
| 17 | NO_MATCH semântico | Evidência conflitante | Matcher V2 | N/A | Item negativo | Parcial | Misturado com ausência de evidência | Reservar a evidência negativa/conflitante |
| 18 | Technical Match | Compatibilidade profissional | Scoring Engine | N/A | Overall score | Parcial | Incluía parseabilidade/ATS do currículo | Remover documento do score técnico |
| 19 | Document ATS Compatibility | Métrica separada | Resume Parseability | N/A | `resumeAtsScore` | Parcial | Influenciava Technical Match | Estado independente, inclusive `NOT_EVALUATED` |
| 20 | Analyze sem currículo | Declarado possível | `analyzeUnifiedAts` | N/A | Erro de validação | Ausente | Endpoint exigia `resumeId` | Candidate Knowledge + vaga bastam |
| 21 | Candidate Knowledge | Fonte canônica | `candidateFacts.active()` | N/A | Evidências de conhecimento | Parcial | Sem teste do caso Grafana | Testar evidência positiva sem menção no currículo |
| 22 | Classificação comunitária | Detecta hiring intent | Regex determinística | Evolution inbound | Lead ou descarte | Básico | Vocabulário obrigatório incompleto | Expandir padrões PT/EN e direct message |
| 23 | Extração comunitária | Fatos estruturados | `extractLeadFacts` | Evolution inbound | Título=primeira linha | Ausente | Sem senioridade, skills, location e target completo | Extrator determinístico estruturado |
| 24 | DIRECT_MESSAGE | Método suportado | Detector | Evolution inbound | `UNKNOWN` | Ausente | Padrões não reconhecidos | Detectar privado/inbox/DM/message/reach out |
| 25 | Cross-source reconciliation | Uma oportunidade, várias proveniências | Canonical resolver | Providers + community | IDs distintos | Ausente | Lead promovido usava hash isolado | Reconciliar com confiança, autoridade oficial e histórico de fontes |
| 26 | Evolution webhook runtime | Configuração real | Connection service | Evolution 2.3.7 | Config pública | Parcial | Sem diagnóstico de webhook inbound configurado | Estado seguro configurado/não configurado/erro e procedimento legítimo |
| 27 | n8n truth | Estado operacional composto | Runtime diagnostics | n8n | Health + flag local | Parcial | Não distinguia workflow, atividade, webhook e HMAC | Diagnóstico granular sem ativação automática |
| 28 | Ollama truth | Opcional e dimensionado | Intelligence status | Ollama | Status genérico | Parcial | Perfil de hardware/concurrency não aparecia claramente | Expor perfil, contexto e concorrência sem baixar modelo |
| 29 | Audit export | Pacote seguro | PowerShell export | N/A | ZIP auditável | Validador existente | Requer revalidação das exclusões V4.1 | Cobrir dados, CVs, QR, screenshots, logs e segredos |
| 30 | Homologação externa | Checklist explícito | Docs/scripts | Brave/Evolution/n8n/Ollama | Estados locais | Parcial | Online local podia ser confundido com homologado externamente | Checklist de 17 evidências e matriz de capacidade |

## Limites fixados

- Sem V5, Experience V3, Candidate Knowledge V3, LinkedIn OAuth, Controlled Submission ou implementação completa de Gupy.
- Sem reset de dados e sem migration nova quando os contratos atuais forem suficientes.
- Sem ativação automática de perfil, workflow, grupo comunitário ou envio de candidatura.
- Sem segredos no frontend, logs, documentação, pacote de auditoria ou resposta de API.
- Sem commit, push, merge ou rebase durante esta entrega.
