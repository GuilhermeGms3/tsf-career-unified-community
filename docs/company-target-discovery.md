# Descoberta de targets de empresa

Há quatro entradas legítimas: empresas já conhecidas em watchlists/boards/proveniência; URL pública colada pelo usuário; recomendações derivadas de vagas persistidas; e o catálogo versionado de boards cuja identidade pública foi validada. Não existe um diretório global inventado.

Nome não resolvido retorna `NEEDS_URL`. URL passa por `assertSafeDiscoveryUrl`, incluindo protocolo, DNS/endereços privados e redirects, e depois pelo `SourceResolver`. Greenhouse, Lever, Ashby, SmartRecruiters, Workable e Gupy extraem a identidade do board sem exigir `organizationKey` na UX normal.

Preview consulta no máximo um board e 20 vagas, com cache de 10 minutos por provider/target/versão do intent. Nada é monitorado até `POST /api/source-center/companies/monitor`.

`npm run discovery:targets:sync` revalida o catálogo sem gravar. A opção `-- --apply` monitora somente os targets que ainda retornam ao menos uma vaga pública e desativa registros históricos comprovadamente inválidos; a operação é idempotente e não transforma um board vazio em sucesso.

O catálogo versionado atual contém 133 boards comprovados: 17 Greenhouse, 10 Lever, 11 Ashby, 11 SmartRecruiters, 14 Workable e 70 Gupy. Targets com vagas Brasil e Brasília/DF recebem prioridade maior. O Mass Hunt encaminha esses targets ao Job Hunt, respeita o orçamento por provider e rotaciona o ponto inicial a cada rodada para não consultar sempre as mesmas empresas.

Uma resposta limitada não é tratada como inventário completo. Se o board informar ou indicar que há mais vagas do que o limite recebido, a descoberta atualiza as vagas vistas, mas não encerra as ausentes. O fechamento por ausência só ocorre quando a listagem pública foi comprovadamente completa.
