# Contribuindo

Obrigado por ajudar o TSF Career Unified Community.

## Fluxo recomendado

1. Abra uma issue descrevendo comportamento atual, comportamento esperado e evidências.
2. Crie uma branch curta e mantenha a alteração focada.
3. Use somente fixtures fictícias e sanitizadas.
4. Execute **npm run check:syntax** e os testes relacionados.
5. Para mudanças amplas, execute também **npm test**.
6. Explique no pull request riscos, limitações e validações executadas.

## Regras importantes

- Não envie currículos, bancos SQLite, arquivos .env, tokens, cookies ou sessões.
- Não automatize bypass de CAPTCHA, MFA ou autenticação.
- Não marque submissão como confirmada sem evidência ou recibo.
- Mantenha fonte de descoberta separada do destino final da candidatura.
- Preserve idempotência e revisão humana em ações irreversíveis.

Ao adicionar um provider, inclua normalização, healthcheck, telemetria e testes com fixtures.
