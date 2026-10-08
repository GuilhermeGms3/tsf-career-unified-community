# Referências externas para AutoApply

Esta entrega estudou projetos externos em clones temporários e manteve a arquitetura do TSF. Nenhum framework, banco, agente autônomo ou bypass foi importado.

## Aproveitado

- `AbhishekMandapmalvi/AutoApply` (MIT): padrões de detecção do formulário Lever, boundary explícita e parada diante de CAPTCHA.
- `AkbarDevop/ai-job-agent` (MIT): sinais de confirmação por texto/URL e tratamento conservador de campos obrigatórios.
- `Malik1942/job-agent`: somente ideias de segurança, sem copiar código por ausência de licença explícita.

Os conceitos foram reimplementados sobre `AdapterRegistry`, `SubmissionPreflight`, consentimento, lock, idempotência e receipts já existentes. O TSF exige confirmação positiva; projetos que tratam um clique sem erro como sucesso não foram seguidos.

Em 04/10/2026, os dois repositórios MIT foram clonados novamente para comparação. O adapter Lever do `AutoApply` continua retornando sucesso após o clique sem recibo; o script Greenhouse do `ai-job-agent` usa preenchimento direto de campos e não substitui o preflight, consentimento e auditoria do TSF. Nenhum motor externo foi incorporado. A inspeção de uma página SmartRecruiters real revelou somente um campo de compartilhamento; o adapter hospedado agora exige campo reconhecível de identidade, contato ou currículo antes de declarar o formulário suportado.

## Rejeitado

- solucionadores de CAPTCHA, bypass de permissões ou anti-bot;
- automação de LinkedIn baseada em Selenium;
- retry cego depois do clique final;
- importação integral de bots que criaria outro pipeline de candidatura;
- Workday nesta Story, por exigir famílias de layouts, autenticação e fixtures próprias.
