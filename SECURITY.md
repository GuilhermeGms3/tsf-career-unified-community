# Segurança

## Relato de vulnerabilidade

Evite publicar tokens, dados pessoais ou detalhes exploráveis em issues. Use o canal privado de security advisories do GitHub para vulnerabilidades.

Inclua versão ou commit afetado, impacto observado, passos mínimos para reprodução e sugestão de mitigação quando houver.

## Limites operacionais

Esta aplicação processa currículos, credenciais opcionais e ações de candidatura. Execute-a localmente por padrão. Antes de expor qualquer serviço:

- configure segredos fortes no arquivo .env;
- limite portas ao host necessário;
- habilite autenticação e TLS em um proxy confiável;
- revise permissões de integrações;
- mantenha bancos e painéis administrativos fora da internet pública;
- faça backup criptografado dos dados locais.

CAPTCHA, MFA, login e resultados ambíguos devem interromper a automação e exigir intervenção humana.
