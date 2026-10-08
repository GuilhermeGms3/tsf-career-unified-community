# Submission Receipts

Receipt é evidência de confirmação, não intenção. Ele referencia Application, tentativa, provider, horário, ResumeVersion e hash das respostas. Referência externa, URL e texto curto de confirmação são opcionais e sanitizados.

Ausência de confirmação produz `SUBMISSION_UNCERTAIN`, nunca um receipt otimista. Um receipt é único por tentativa e a Application só vira `SUBMITTED` depois que ele é persistido.

URLs aceitas são HTTPS sem credenciais; HTTP existe somente para loopback de teste explicitamente habilitado. Esquemas ativos, hosts arbitrários e metadados fora da allowlist são descartados. Texto e referência têm limites e não armazenam HTML, cookies ou conteúdo integral do formulário.
