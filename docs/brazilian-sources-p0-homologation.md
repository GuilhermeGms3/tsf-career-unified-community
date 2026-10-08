# Brazilian Sources P0 — homologação real

Data: 23/08/2026. Comando reproduzível: `npm run discovery:brazil:p0:live`.

## 1. Veredito

**COMPLETE WITH PROVIDER BLOCKERS.** IEL, ProgramaThor, Sólides e Recrutei têm providers operacionais no pipeline comum. Eureca permanece `MANUAL_ONLY`/`PUBLIC_WEB_DISCOVERABLE` porque nenhum catálogo atual ou feed sustentável foi comprovado.

## 2. Auditoria por fonte

| Source | Access method | Implemented | Real called | Real results | Source Center | Status | Blocker |
|---|---|---:|---:|---:|---:|---|---|
| IEL | sitemap + `JobPosting` | sim | sim | 5 em teste direcionado; 0 na consulta comum do Mass Hunt | sim | READY | catálogo muito orientado a curso/UF; consulta “Desenvolvedor” não retornou item no budget |
| Eureca | site/sitemap institucional | não automático | site auditado | nenhum catálogo atual | sim | MANUAL_ONLY | ausência de listagem/feed atual sustentável |
| ProgramaThor | sitemap + `JobPosting` | sim | sim | 5 no teste direcionado; 28 no Mass Hunt | sim | READY | 2 detalhes falharam isoladamente no Mass Hunt, sem derrubar a fonte |
| Sólides | endpoint JSON público do portal | sim | sim | 5 no teste direcionado; 7 no Mass Hunt | sim | READY | endpoint operacional sem contrato público de developer API |
| Recrutei | sitemap + `JobPosting` | sim | sim | 5 no teste direcionado; 24 no Mass Hunt | sim | READY | sitemap recente limita a janela de descoberta |

## 3. IEL

O portal é nacional, mas as URLs e organizações preservam a regionalização por UF. O adapter não usa `/api/`, pois o `robots.txt` a bloqueia. O teste real “Tecnologia da Informação”, “Brasília, DF” retornou cinco vagas dentro do budget; a amostra incluiu o ID `30009`, Brasília/DF, além de estágio em RN e AM. `APPRENTICESHIP` só é aplicado quando aprendizagem/aprendiz está explícito; título com estágio tem precedência.

## 4. Eureca

O site oficial apresenta programas, cases e conteúdo institucional, mas não expôs catálogo atual, feed de vagas ou API pública sustentável. Cases históricos não são promovidos a Job. A UI oferece “Abrir portal” e captura manual; Public Web pode localizar uma página quando Brave estiver configurado.

## 5. ProgramaThor

Provider global de tecnologia, sem login para discovery. Preserva ID numérico, título, empresa, descrição, data, localização, remoto e escopo declarado. O parser tolera JSON-LD público com quebras de linha inválidas sem executar HTML. Teste direcionado encontrou cinco vagas júnior; no Mass Hunt foram 28 canônicas, uma passou PreMatch e obteve Match 80, Coverage 58 e Confidence 58.

## 6. Sólides e Recrutei

São providers separados. Sólides usa a busca global pública chamada pelo próprio portal; Recrutei usa somente sitemap/páginas e nunca `/api/` nem query params bloqueados. Ambos também possuem páginas por empresa, mas o P0 não os força ao Company Radar. Sólides retornou sete itens no Mass Hunt, todos corretamente rejeitados pelo intent remoto/júnior; Recrutei retornou 24, dois chegaram ao Matcher.

## 7. Pipeline

`ProviderRegistry → normalizeDiscoveryJob → SourceResolver → CanonicalJobResolver → dedup/provenance → PreMatch R2 → Matcher V2 → Opportunity Priority/persistência`.

Nenhum provider possui store, entidade Job ou matcher paralelo.

## 8. Dedup

IDs são estáveis por provider. URLs oficiais brasileiras agora são reconhecidas pelo `SourceResolver`; a mesma URL encontrada pelo provider e por Public Web produz a mesma identidade `ats/provider + organizationKey + providerJobId`. A regressão cross-source confirma a igualdade canônica e preservação de proveniência.

## 9. Source Center

Os quatro providers operacionais aparecem `READY`, com Test Search/Buscar agora, coverage, modo, localizações, tipos, autenticação e limitações. Eureca aparece `MANUAL_ONLY`. Todos os novos providers ficam desmarcados no Composer até seleção explícita.

## 10. Homologação real

Busca Mass Hunt: termo `Desenvolvedor`, intent `INTERNSHIP/JUNIOR`, remoto Brasil, uma query, quatro requests lógicas, store temporário isolado.

| Source | Requests | Raw | Unique | PASS | WARN | REVIEW | REJECT | Matched | Relevant | Errors | Latency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| IEL | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 188 ms |
| ProgramaThor | 1 | 28 | 28 | 1 | 0 | 0 | 27 | 1 | 1 | 2 detalhes | 9.242 ms |
| Sólides | 1 | 7 | 7 | 0 | 0 | 0 | 7 | 0 | 0 | 0 | 4.755 ms |
| Recrutei | 1 | 24 | 24 | 1 | 1 | 0 | 22 | 2 | 1 | 0 | 3.093 ms |

## 11. Mass Hunt Brasil

Status `COMPLETED`: 59 raw, 59 normalizadas, 59 canônicas, 59 PreMatch, 3 passaram, 3 avaliadas pelo Matcher, 2 relevantes, 0 prioritárias e 0 erros de execução. Filtros: 33 location mismatch, 37 seniority mismatch e 3 stale. Não houve candidatura, outbound ou currículo preparado.

## 12. Qualidade

Ranking auditado coloca itens avaliados pelo Matcher antes dos rejeitados. `precision@5 = 0,40`, `precision@10 = 0,20`, `precision@20 = 0,10` usando GOOD/total. A precisão bruta é baixa porque a query ampla encontrou muito pleno/sênior e presencial; o PreMatch evitou que 57 itens inadequados chegassem à fila relevante. Top real:

- GOOD: Recrutei `155091`, Desenvolvedor Java Junior remoto — Match 82, Coverage 62, Confidence 62.
- GOOD: ProgramaThor `33676`, Backend Júnior remoto — Match 80, Coverage 58, Confidence 58.
- QUESTIONABLE: Recrutei `154841`, Python/IA, senioridade desconhecida — Match 51, Coverage 58, Confidence 58.

## 13. Coverage

No Mass Hunt: 49 `JOB`, 6 `CONTRACT`, 1 `INTERNSHIP`, 3 `UNKNOWN`. O teste direcionado IEL cobriu Brasília/DF e estágio/aprendizagem. O escopo remoto não é inferido como worldwide; ausência permanece `UNKNOWN` e é tratada conservadoramente.

## 14. Segurança e compliance

Somente GET público, sem cookie, token, login ou dados de candidato. IEL/Recrutei `/api/` não são chamados. Respostas têm limite de bytes, timeout, redirect/SSRF guard e retries limitados. HTML externo vira texto; logs não guardam body. Não houve auto-apply, envio, outreach ou bypass.

## 15. Limitações

- Sitemap pode atrasar remoção/adição e exigir detalhes adicionais.
- ProgramaThor apresentou duas falhas de detalhe isoladas no run final.
- Sólides é API pública operacional do portal, não contrato formal de integrador.
- Recrutei expõe apenas janela recente no sitemap usado.
- Eureca bloqueia conclusão total sem um feed/catálogo atual legítimo.
- Query ampla tem baixa precisão bruta; perfis reais devem usar famílias/senioridade/localização específicas.

## 16. Testes

- `npm test`: 472/472.
- Testes P0 offline: parser, controles JSON-LD, IEL, ProgramaThor, Sólides, Recrutei, registry, Source Center, IDs, dedup, Composer e policy.
- `npm run test:playwright`: 108/108.
- Dez validadores especializados passaram: Discovery, V4, V4.1, V4.1.1, Relevance R2, provider routing, cross-source, Search Composer, Source Center V2 e scheduler.
- `docker compose config --quiet` passou e `docker compose build app` reconstruiu `career-hub-unified:local` sem reiniciar os serviços.
- O audit export foi validado em extração limpa: 411 entradas e 3/3 testes mínimos. O atalho `audit:validate` exige `-Path` explícito.

## 17. Migration

Nenhuma. `CAREER_PAGE` continua o método canônico persistido; `applicationMethodEvidence.platform=true` distingue plataforma pública sem reconstruir constraints históricas.

## 18. Commit

O hash e o título são informados no handoff depois de testes, audit, revisão de secrets e criação do commit local. Não haverá push.

## Critérios de aceitação

1. SIM — auditadas antes da implementação.
2. SIM — nenhuma integração inventada.
3. SIM — nenhum login scraping.
4. SIM — arquitetura comum.
5. SIM — sem domínio Job paralelo.
6. SIM — IDs estáveis.
7. SIM — dedup cross-source testado.
8. SIM — proveniência preservada.
9. SIM — Search Intent obrigatório.
10. SIM — PreMatch R2 obrigatório.
11. SIM — Matcher/policy não bypassados.
12. SIM — estágio first-class.
13. SIM — geografia brasileira preservada.
14. SIM — remoto não implica worldwide.
15. SIM — tipos diferenciados.
16. SIM — freshness aplicado.
17. SIM — status honesto no Source Center.
18. SIM — fontes READY selecionáveis e não default.
19. SIM — Test Search por provider.
20. SIM — provider truth real.
21. SIM — falha isolada não derruba o Mass Hunt.
22. SIM — timeout/retry limitados.
23. SIM — scheduler não foi alterado; regressões permanecem verdes.
24. SIM — quatro fontes homologadas externamente.
25. SIM — Mass Hunt Brasil controlado.
26. SIM — top 5/10/20 auditado.
27. SIM — nenhum auto-apply.
28. SIM — revisão de secrets/PII exigida no gate final.
