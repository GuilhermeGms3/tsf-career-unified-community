# Discovery Engine V3

O Discovery V3 amplia cobertura sem ampliar a autoridade do produto: encontra, normaliza, canonicaliza, deduplica, filtra e prioriza vagas; nunca envia candidatura. O fluxo é `SearchIntent -> Query Expansion -> Source Planner -> providers -> normalização/canonicalização -> lifecycle/cheap filters -> Matcher -> Opportunity Priority -> Autopilot -> currículo/alerta`.

As fontes permanecem em três camadas: busca ampla via JobSpy; ATS direto por identidade de empresa; e Company Radar para páginas públicas. Cada execução registra consultas, providers, requests, resultados brutos e canônicos, duplicatas, fechadas, plausíveis, high match, alertas, erros e duração. Falha parcial vira diagnóstico e não apaga oportunidades já encontradas.

Antes de qualquer análise semântica são aplicados dedup, lifecycle, localização, modalidade, senioridade e candidatura existente. A expansão semântica é opcional; o catálogo determinístico e o funcionamento offline são suficientes. `LOW_VRAM` continua sequencial.

## Limites de segurança

- páginas informadas pelo usuário passam por bloqueio de protocolos inseguros, credenciais embutidas, localhost, redes privadas, link-local e destinos resolvidos para IP privado;
- páginas genéricas usam apenas GET público limitado, redirects revalidados e até 2 MB; nesta versão a extração automática se limita a JSON-LD `JobPosting` e sinais simples;
- não há login scraping, bypass de CAPTCHA/MFA, stealth, proxy rotation, auto-submit ou envio automático de e-mail.
