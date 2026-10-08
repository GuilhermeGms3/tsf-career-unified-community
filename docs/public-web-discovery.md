# Public Web Discovery

O único provider web desta versão usa a Brave Search API oficial. `BRAVE_SEARCH_API_KEY` ausente produz `CONFIG_REQUIRED`; não existe fallback por scraping de buscadores. As Bing Search APIs legadas não são usadas porque foram retiradas em 11/08/2025.

Consultas combinam intenção de contratação versionada em PT-BR/EN, família/cargo, senioridade, localização e modalidade. O Query Budget limita quantidade, requests, concorrência, timeout e retries. Resultados guardam somente título, URL, trecho mínimo e proveniência; são leads/sinais, não vagas confirmadas.

LinkedIn permanece `MANUAL_ONLY`: URL/texto fornecido pelo usuário ou link-out originado por busca pública legítima. Não há login, cookie, feed/profile scraping, Playwright, extensão, crawling ou bypass. OAuth futuro deve entrar como provider oficial sem alterar o domínio.
