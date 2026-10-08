# Opportunity Leads

`OpportunityLead` preserva um possível anúncio ainda incompleto. Campos ausentes não são inventados. Um lead só pode ser promovido quando possui título e um método de aplicação acionável (`sourceUrl` ou contato explícito), não está em revisão de risco e a ação humana solicita promoção.

Métodos: `ATS`, `EMAIL`, `WHATSAPP`, `DIRECT_MESSAGE`, `EXTERNAL_FORM`, `CAREER_PAGE`, `MANUAL`, `UNKNOWN`. Nenhum método executa contato automaticamente.
