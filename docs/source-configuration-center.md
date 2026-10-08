# Central de configuração de fontes V2

A central diferencia honestamente `READY`, `IDENTITY_REQUIRED`, `CREDENTIAL_REQUIRED`, `AUTH_REQUIRED`, `AGGREGATOR_ONLY`, `UNSUPPORTED`, `EMPTY`, `OFFLINE`, `DEGRADED` e `ERROR`.

Cada card agora informa em linguagem humana o que a fonte faz, o estado e o próximo passo. O wizard separa discovery de application, explica o que falta, apresenta passos, ajuda junto de cada campo, documentação/portal oficial e ações de detectar URL, salvar, testar e buscar. Identidade técnica fica recolhida e normalmente é preenchida pela auto-detecção.

Desde o Source Connection Center V2, Brave pode ser conectada in-app: o browser envia a credencial somente ao endpoint de teste/conexão e nunca a recebe de volta. O cofre e a separação de chave estão documentados em [source-credentials-security.md](./source-credentials-security.md). Variáveis de ambiente permanecem como fallback compatível.

Identidades públicas e metadata opaca são persistidas em SQLite; valores completos nunca são retornados pela API.

## Fontes e contratos usados

- [Greenhouse API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview): Job Board API para posts públicos; submit exige autenticação.
- [Lever Postings API](https://github.com/lever/postings-api): site/organização pública.
- [Ashby Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api): nome da jobs page.
- [SmartRecruiters Posting API](https://developers.smartrecruiters.com/docs/endpoints): identidade da empresa.
- [Workable careers API](https://help.workable.com/hc/en-us/articles/115012771647-Using-the-Workable-API-to-create-a-careers-page): subdomínio público; SPI avançada usa token.
- [Gupy Developers](https://developers.gupy.io/): APIs empresariais autenticadas não foram tratadas como discovery público.
- [Vagas for Business APIs](https://ajuda-forbusiness.vagas.com.br/portal/pt-br/kb/articles/apis-e-integracoes-vagas-for-business): contratação/ativação necessária.
- [Catho Developers](https://desenvolvedores.catho.com.br/developers-integration-portal): autenticação de empresa/integrador.

Nerdin e ProgramaThor usam sitemap público e dados estruturados `JobPosting`, sem login ou candidatura automatizada. A Remotar usa o catálogo público operacional consumido pelo próprio portal e preserva o link do ATS original. InfoJobs e GeekHunter continuam sem leitura direta nova: sem contrato ou feed público validado, a central mostra a limitação e direciona para documentação/cadastro ou agregadores.

Diagnósticos persistem código, estado humano, motivo e ação recomendada. URLs passam pela proteção SSRF descrita em [Discovery V3](./discovery-v3.md). Consulte a pesquisa completa em [source-capabilities.md](./source-capabilities.md).

## Experience V2.1

Cada card informa capacidade comprovada, último teste, quantidade de vagas, problema atual e próxima ação. O assistente salva identidade/URL antes do teste, detecta o ATS quando possível, mascara o estado de credenciais e oferece documentação oficial sem expor segredos ao navegador.

## V4

A Central distingue classes de fonte de providers concretos. Public Web mostra `CONFIG_REQUIRED` sem Brave; portais de estágio e consultorias permanecem `UNSUPPORTED` enquanto não houver adapter legítimo. WhatsApp Groups fica na mesma área, com opt-in por grupo e política de privacidade explícita.

Na V4.1, o status do inbound Evolution é `NOT_CONFIGURED`, `CONFIGURED` ou `ERROR`; o segredo nunca é retornado. Providers só ficam `CONSULTED` depois de uma chamada real, e classes sem board ou Company Radar ativo mostram `NO_TARGETS`.
