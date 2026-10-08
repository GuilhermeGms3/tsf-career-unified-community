# Segurança

Controles relevantes: URL pública validada contra SSRF e redirects privados; credenciais cifradas fora do banco; master key separada; respostas mascaradas; auditoria metadata-only; audit export exclui dados, credentials, secrets e runtime; nenhum segredo em query string; limites de payload, request, timeout e cache.

O Source Center não enfraquece autenticação, não abre portas administrativas e não adiciona scraping autenticado. Consulte [source-credentials-security.md](./source-credentials-security.md).

## Application Engine V2

O consentimento é armazenado apenas como hash e expira; snapshots invalidam autorização antiga. Chaves de idempotência, lock por Application, rate limit, kill switch e estado `SUBMISSION_UNCERTAIN` evitam duplicidade e retry cego. Login, MFA, CAPTCHA e anti-bot são handoffs humanos. Senhas, cookies, sessões, token de consentimento e conteúdo sensível não entram em eventos ou receipts. A sessão interativa vive apenas em memória com TTL. O target Greenhouse é allowlisted, resolvido no backend e o transporte externo permanece deny-by-default.

Screenshots de automação mascaram todos os controles editáveis. O trace é metadata-only, sem screenshots, snapshots DOM ou source, evitando que valores preenchidos sejam incorporados ao ZIP.
