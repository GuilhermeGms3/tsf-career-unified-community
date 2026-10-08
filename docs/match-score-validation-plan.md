# Match Score — plano de validação empírica

## Escopo e interpretação correta

O Career Unified mantém sinais distintos:

- **Technical Match**: ranking interno explicável calculado somente sobre requisitos com evidência conhecida;
- **Evidence Coverage**: fração ponderada dos requisitos que pôde ser avaliada;
- **Match Confidence**: confiança operacional derivada da cobertura e penalizada por requisitos obrigatórios desconhecidos;
- **Eligibility**: gate de bloqueios objetivos e itens que exigem revisão;
- **Opportunity Priority**: ordenação de ação, combinando match, confiança, atualidade, preferências, qualidade e esforço;
- **Document ATS Compatibility**: parseabilidade do artefato de currículo, independente do Technical Match.

Nenhum deles representa “chance de contratação”, score real de um ATS externo, teste psicométrico ou decisão autônoma de emprego.

## Base técnica

Trabalhos de matching entre currículo e descrição demonstram que modelos contextuais podem aprender representações úteis, mas também mostram erros entre níveis adjacentes e dependem de dados rotulados por especialistas. Um estudo EMNLP usou 6.492 currículos de 24.933 candidaturas, com anotação humana repetida, o que reforça que resultados de outro domínio não validam automaticamente este produto ([Li et al., 2020](https://aclanthology.org/2020.emnlp-main.679/)).

Para ranking, a validação deve medir a qualidade da ordem dos resultados, não apenas acurácia global. `precision@k` mede quantos itens no topo são relevantes; `recall@k`, quanto do conjunto relevante foi recuperado; e `nDCG@k`, se itens mais relevantes aparecem antes, permitindo julgamentos graduais.

Procedimentos usados em seleção precisam ser relacionados ao trabalho e avaliados quanto a impacto discriminatório; supervisão e análise estatística não são opcionais quando a ferramenta afeta pessoas ([EEOC, Employment Tests and Selection Procedures](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures)). Para governança contínua, o plano segue as funções Govern, Map, Measure e Manage do [NIST AI Risk Management Framework](https://airc.nist.gov/airmf-resources/airmf/).

## Dataset futuro

O conjunto rotulado deve nascer de uso real consentido e minimizado:

```text
application outcomes
        ↓
human relevance judgment
        ↓
labeled, versioned dataset
        ↓
offline ranking evaluation
        ↓
calibration and slice analysis
        ↓
shadow validation before policy changes
```

Cada exemplo deve registrar, sem atributos desnecessários: versão do anúncio, requisitos extraídos, evidências usadas, scores e componentes, decisão humana de relevância (irrelevante/parcial/relevante/prioritária), estágio da candidatura e motivo padronizado. Outcome de processo seletivo não deve ser tratado sozinho como verdade de competência, pois contém ruído do mercado e decisões externas.

## Protocolo de anotação

1. Definir rubrica de relevância por família e senioridade antes de olhar scores.
2. Usar ao menos dois avaliadores nos subconjuntos de calibração e adjudicar divergências.
3. Medir concordância entre avaliadores; baixa concordância indica requisito/rubrica ambíguos.
4. Separar conjunto de desenvolvimento, validação e teste temporal.
5. Congelar versões do parser, Candidate Knowledge, Matcher e políticas em cada rodada.
6. Não usar atributos protegidos como features de ranking; quando legal e consentido, usá-los apenas em avaliação agregada de impacto.

## Métricas

| Métrica | Pergunta | Uso |
|---|---|---|
| Precision@k | Quantas das primeiras `k` oportunidades foram julgadas relevantes? | Qualidade da caixa de decisão diária |
| Recall@k | Quantas oportunidades relevantes conhecidas apareceram nas primeiras `k`? | Risco de omissão |
| nDCG@k | A ordem respeita relevância graduada? | Comparar versões do ranking |
| Calibration | Scores/faixas correspondem a frequências observadas do julgamento-alvo? | Somente após definir um alvo mensurável; nunca converter diretamente em chance de contratação |
| False positives | Quais irrelevantes foram promovidas? | Reduzir ruído e ações indevidas |
| False negatives | Quais relevantes foram filtradas? | Reduzir perda de oportunidades |
| Coverage/abstention | Quanto ficou `UNKNOWN` ou `REVIEW_REQUIRED`? | Verificar honestidade epistêmica |
| Drift | A distribuição de vagas, requisitos e erros mudou? | Monitoramento temporal e por versão |

## Slices obrigatórios

Reportar as métricas por família (`Software Internship`, `Backend`, `Infrastructure`, `NOC/Operations` etc.), senioridade, modelo de trabalho, fonte/provider, idioma, faixa de Evidence Coverage e presença/ausência de currículo. Amostras pequenas devem ser declaradas, não suavizadas como evidência forte.

## Critérios para mudança

Uma alteração de peso ou threshold só avança quando supera o baseline em `nDCG@k` e não degrada materialmente `recall@k`, falsos negativos, cobertura/abstenção ou slices críticos. Mudanças rodam primeiro em replay offline, depois shadow mode, depois liberação controlada com rollback. Julgamento humano permanece autoridade.

## O que a R1 valida e o que não valida

A R1 valida invariantes funcionais dos casos A–E: evidência conhecida, `UNKNOWN`, evidência negativa, Candidate Knowledge como fonte e independência entre Technical Match e parseabilidade do currículo. Ela não fornece tamanho amostral, ground truth, outcome longitudinal, calibração ou validade preditiva. Esses itens permanecem pendentes até existir dataset real rotulado e revisão humana documentada.

## Auditoria observada na finalização da R1

Em 2026-08-23, os testes A–E voltaram a confirmar as invariantes acima. A revisão manual das dez primeiras oportunidades reais da janela R1, porém, encontrou ruído material: vagas de laboratório veterinário e economia promovidas como aderentes a tecnologia, co-ops estrangeiros fora da preferência geográfica e um edital com título de 2021. Havia também resultados úteis, como estágio de suporte de TI e banco de talentos de estágio em TI.

Esse resultado separa duas conclusões:

- **correção funcional: aprovada** — `UNKNOWN` reduz coverage/confidence sem virar falso `NO_MATCH`; evidência negativa é localizada; Candidate Knowledge participa; compatibilidade documental não altera Technical Match;
- **qualidade empírica/calibração: não aprovada** — a pequena amostra não mede validade preditiva e revela falsos positivos de família, geografia e freshness no topo.

Antes de aumentar volume, o próximo experimento deve criar um conjunto rotulado com julgamentos `GOOD_RESULT`, `QUESTIONABLE`, `IRRELEVANT`, `DUPLICATE` e `NEEDS_REVIEW`, medir `precision@10`, `recall@k` e `nDCG@10` por família/senioridade/fonte e executar alterações de filtro/ranking em replay e shadow mode. O objetivo de calibração é prever o julgamento humano definido na rubrica, nunca “chance de contratação” nem “score real do ATS”.
