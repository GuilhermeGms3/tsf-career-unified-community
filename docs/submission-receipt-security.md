# Submission Receipt Security

Receipts armazenam somente provider, referência curta, horário, ResumeVersion, hash de respostas, URL sanitizada, texto curto e metadados allowlisted. Não armazenam HTML, respostas integrais, cookies, tokens, headers ou screenshot com PII.

URLs externas precisam ser HTTPS, sem usuário/senha e sem esquema ativo. HTTP é aceito apenas em fixture loopback explicitamente habilitada. Metadados permitidos: `verificationMethod`, `confirmationKind`, `providerStatus` e `fixtureId`.
