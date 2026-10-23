# Alternativas publicas e curriculos offline

## Diagnostico de 12/10/2026

A API atual `vagas.solides.com.br/api/vacancies` respondeu HTTP 200 e cinco
vagas. O HTTP 502 observado foi do Recrutei: sitemap e pagina inicial retornam
`502 Bad Gateway` do nginx. O site institucional Recrutei responde 200 e ainda
aponta para esse portal; nao ha evidencia de uma nova URL substituta funcional.
Isso indica indisponibilidade do servico de origem, nao erro de deduplicacao.

## Estrategias limitadas

- Sitemaps de IEL, ProgramaThor, Nerdin e Recrutei: consulta primaria com no
  maximo um retry, depois leitura dos links publicos da pagina inicial.
- Solides: API primaria com no maximo um retry, depois catalogo HTML publico
  `/vagas/todas`, usando somente dados serializados, sem executar scripts.
- Alternativa: uma tentativa, timeout e limite de bytes do SafeHttpClient.
- Somente falhas transitorias (5xx, timeout, rede) permitem alternativa.
  403, CAPTCHA, login, 429 e bloqueios de seguranca nao autorizam contorno.
- Links alternativos devem pertencer ao mesmo origin, corresponder ao padrao
  de vaga e nao incluir query. Demais providers mantem suas estrategias atuais;
  nao se inventou um fallback universal para endpoints sem alternativa validada.
- A alternativa HTML pode ter cobertura menor. Ausencia de links reconhecidos
  e falha de parsing, nao confirmacao de catalogo vazio nem encerramento de vagas.
- Se ambas falharem, `alternativesExhausted` interrompe novas consultas a essa
  fonte na rodada do Mass Hunt. Outras fontes continuam. Nova rodada manual
  permite tentar novamente; o botao por portal no Historico foi preservado.
- Paginas Solides recebidas antes de uma falha posterior permanecem no
  resultado DEGRADED. Nenhuma vaga salva e apagada por erro de transporte.

Relatorios e logs registram `strategyAttempts`, `alternativesExhausted` e
`PROVIDER_ACCESS_STRATEGY`. Historico resumido carrega ate quatro tentativas
recentes por fonte e uma orientacao explicita quando alternativas esgotarem.

Validacao real: a API Solides respondeu normalmente. Com falha da API injetada
no teste, o HTML real retornou cinco vagas com descricoes de 530 a 2.856
caracteres. Isso prova o parser alternativo, nao uma falha real da API naquela
consulta. Recrutei confirmou duas estrategias com HTTP 502.

## Biblioteca editorial offline

`resume-perspective-library.mjs` versiona textos salvos `role-texts-v2`:
suporte, redes, NOC, infraestrutura, cloud, desenvolvimento, seguranca/SOC,
dados e qualidade. Sao tres perspectivas de resumo por familia, combinadas
somente com fatos encontrados nas evidencias do candidato, e regras editoriais
para reescrever bullets existentes. Nao e copia de um curriculo de outra pessoa.

A revisao v2 troca a formula generica de formacao + lista de stacks + frase
de objetivo por ate duas atividades reais pertinentes a vaga. As atividades
precisam de evidencia no mesmo contexto (experiencia ou projetos), sao
priorizadas pela descricao e familia e permanecem identificadas como projetos
quando essa e sua origem. Bullets longos ou sem construcao nominal segura nao
sao concatenados em frases gramaticalmente quebradas. Sem atividades
utilizaveis, o resumo descreve conhecimentos, sem promove-los a experiencia.
O estilo editorial padrao e impessoal, sem primeira pessoa.
O prompt `resume-tailor-v10` pede o mesmo estilo quando a LLM estiver online;
primeira pessoa no resumo gera revisao editorial, nao alteracao de fatos nem
dispensa de aprovacao.

O gate editorial sinaliza para revisao a combinacao "Profissional de
tecnologia" com "Vivencia com" ou "Atuacao voltada". Essa heuristica nao e
uma garantia de naturalidade: a leitura humana continua necessaria. Versoes
imutaveis ja enviadas nao mudam; a correcao exige gerar um novo pedido.

O titulo da vaga orienta a familia; requisitos e descricao orientam a selecao
de stacks comprovadas. Cargo, empresa, datas, template BASE 01 e links nao
sao substituidos. Projetos nao sao deslocados para outra experiencia. Curso
em andamento nao e apresentado como concluido, e N2 exige mencao na fonte.

ResumeTailor consulta disponibilidade local com cache de 30 segundos e probe
compartilhado. Com modelo disponivel, tenta a LLM e compara candidatos pelo
fluxo existente. Sem LLM ou apos falha, utiliza biblioteca; timeout/offline
suspende novas chamadas durante a janela. Apos a janela, nova geracao verifica
se o provider voltou, sem reiniciar servidor nem resetar a fila de concorrencia.

Metadata persistida: `generationMode` (LLM/OFFLINE_LIBRARY/BASE_UNCHANGED),
`libraryVersion`, `selectedDomain`, perspectiva, motivos e resultado dos gates.
EvidenceGuard, qualidade editorial, score, revisao e politica de envio continuam
valendo. Nao ha garantia de aumento de score, nem relaxamento de AutoSubmit.
Sem fatos suficientes, preserva base e revisao; nao inventa experiencia para
preencher um modelo offline. Pedido livre de alteracao nao atendido pela
biblioteca continua sujeito a revisao; biblioteca nao interpreta instrucoes
arbitrarias como uma LLM.

Teste em snapshot privado isolado: BASE 01 para suporte, infraestrutura, redes
e desenvolvimento gerou OFFLINE_LIBRARY, evidencia VALID e qualidade PASS.
Nao acionou LLM, WhatsApp, navegador de candidatura ou submissao.

## Verificacao

Testes: `portal-alternatives-offline-library.test.mjs`,
`deterministic-resume-tailoring.test.mjs`, `intelligence.test.mjs`,
`brazilian-sources-p0.test.mjs`, `discovery-recovery-p1.test.mjs` e
`automation-reliability.test.mjs`. Cobre troca de estrategia, esgotamento,
preservacao parcial, parsing de blocos HTML reais, limites de retries,
familias editoriais, retorno da LLM e ausencia de stack sem evidencia.

Fechamento: `npm test` 1252/1252; testes focados finais 131/131;
`npm run check:syntax` PASS em 494 arquivos; `git diff --check` sem erros.
Imagem app reconstruida; smoke sem rede confirmou biblioteca v1, nove familias,
alternativa habilitada para 502 e desabilitada para 403. Stack produtiva mantida
no estado anterior, sem iniciar automacoes como efeito colateral dos testes.
