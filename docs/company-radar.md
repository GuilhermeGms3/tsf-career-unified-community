# Company Radar

Company Radar evolui as watchlists existentes. Aceita nome, URL pública de carreira, domínio e ATS opcional; também recebe até 50 linhas `Nome | URL` por lote. A mesma combinação de domínio/URL é reconciliada em vez de duplicada.

URLs reconhecidas extraem com segurança a identidade de Greenhouse, Lever, Ashby, SmartRecruiters, Workable ou Gupy. Para uma página desconhecida, a foundation segura procura JSON-LD `JobPosting`; um resultado estruturado fica disponível para revisão, e HTML sem contrato permanece `REVIEW_REQUIRED`.

Boards aprendidos continuam no registry existente e a provenance registra provider, URL de origem, identidade canônica, primeira/última observação e snapshots. A prioridade sempre é API oficial pública, endpoint estruturado e dados estruturados; não há crawler irrestrito.

## Experience V2.1

“Empresa encontrada” durante discovery não significa “empresa monitorada”. Somente a inclusão explícita no Company Radar cria monitoramento, e a interface mantém esses estados separados.

Sinais V4 em páginas `/careers`, `/jobs`, `/vagas`, `/trabalhe-conosco`, `/oportunidades`, blogs e notícias podem sugerir contratação, mas permanecem `HiringSignal` até existir uma oportunidade completa. ATS/carreira oficial prevalece em conflitos estruturados.
# Integração Source Center V2

O Company Radar continua sendo a autoridade de detecção/persistência. O Source Center adiciona busca em targets conhecidos, preview limitado por URL, recomendações PreMatch e pausa não destrutiva; não cria diretório global nem salva sem opt-in.
