# Autopilot

## Navegação Experience V2

Autopilot foi dividido em Perfis, Fontes, Empresas, Notificações e Execuções. Source Center V2 e Company Radar são superfícies diferentes; o primeiro descreve capacidade/configuração de provedores, enquanto o segundo organiza empresas monitoradas. Notificações usam linguagem humana e recolhem Evolution/n8n/webhook em detalhes técnicos.

Uma política declara cargos ou termos, regiões, modelos de trabalho, fontes e agenda. Pode ser criada, editada, ativada, pausada, removida e executada manualmente. Políticas novas são salvas pausadas, salvo quando o candidato marca explicitamente a ativação.

## Limiar de cada ação

- `considerThreshold`: abaixo dele a vaga permanece salva, sem entrar no conjunto relevante do Autopilot;
- `prepareResumeThreshold`: a partir dele, se `prepareResume` estiver habilitado e não houver blockers, uma versão pode ser preparada somente como `REVIEW_REQUIRED`;
- `notifyThreshold`: a partir dele, o alerta imediato pode ser emitido, respeitando elegibilidade, quiet hours, deduplicação e limite de alertas.

Os três limiares operam sobre o Technical Match do Matcher para preservar o contrato histórico do Job Hunt. Opportunity Priority continua sendo calculada separadamente para ordenar oportunidades e apoiar a caixa de decisões. A migration 011 copia `minimum_match_score` para os três limiares em perfis existentes; `minimumMatchScore` permanece como alias de compatibilidade de `considerThreshold`.

## Fontes

A tela apresenta Indeed, LinkedIn, Glassdoor, Google Jobs, Greenhouse, Lever, Ashby, SmartRecruiters e empresas monitoradas. `jobspy` é somente o nome do adaptador interno que encaminha os quatro portais agregados e não aparece no Policy Builder. ATS de empresa continuam exigindo identidade/configuração real de board.

Cada execução registra vagas encontradas, selecionadas, alertas e currículos preparados. Preparações permanecem `REVIEW_REQUIRED`. Alertas são deduplicados; falhas de n8n/WhatsApp ficam visíveis e podem ser retomadas sem criar candidatura.

A tela principal usa linguagem de produto e resume a política em uma frase verificável. IDs de provider, n8n e diagnósticos ficam em detalhes avançados. Autopilot nunca inicia Application Engine nem envia formulário.

## Experience V2.1

O Policy Builder expõe Search Intent, famílias profissionais, senioridades (inclusive estágio), modalidades, prioridades de localização, escopo remoto, limiares, agenda, Query Budget, Mass Hunt e preview das consultas. `Test Search` executa uma amostra limitada sem ativar a agenda; `Buscar agora` continua sendo uma ação manual explícita.

## Discovery V4

Autopilot → Fontes também contém WhatsApp Groups. A enumeração vem da instância Evolution conectada sem participantes; nenhum grupo é ativado por padrão. O usuário seleciona o allowlist explicitamente. n8n continua apenas no outbound e não decide se uma mensagem é vaga.
