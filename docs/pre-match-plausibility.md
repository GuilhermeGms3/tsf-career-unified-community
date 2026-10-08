# PreMatchPlausibility

O classificador `pre-match-plausibility-r2-v1` é cheap-first e determinístico. Ele interpreta o anúncio por dimensões estruturais, não apenas por uma lista solta de palavras.

## Família profissional

A taxonomia existente em `JobFamilyCatalog` continua sendo a única autoridade. Alias e sinais no título pesam mais que skills na descrição. Domínios ocupacionais negativos no título — por exemplo veterinária, laboratório, economia ou contabilidade — impedem que uma menção incidental a Python/SQL transforme a vaga em tecnologia. “Automação” só recebe contexto de software quando há múltiplas evidências como Python, API, Git ou integração de sistemas.

No Search Intent v7, DevOps/SRE explícito continua sendo sinal forte. Títulos compartilhados entre disciplinas — Platform, Cloud, Infrastructure, Production e Reliability Engineer — recebem apenas evidência ambígua e precisam de contexto adicional da descrição/requisitos para se tornarem `DEVOPS_SRE`. Query expansion pode procurar esses títulos sem convertê-los automaticamente em compatibilidade.

## Localização e remoto

Localização, modalidade e escopo remoto são dimensões separadas. Brasília, Distrito Federal e DF são normalizados; remoto Brasil rejeita país estrangeiro explícito, aceita Brasil e worldwide, aceita LATAM/Américas com warning e mantém escopo ausente como unknown. Presencial fora da área só é aceito por política explícita.

## Senioridade e tipo

Senioridade explícita no título domina: senior/staff/lead não passa em intenção estágio/júnior; estágio/co-op e júnior são distintos; ausência vira `UNKNOWN_SENIORITY`, não `NO_MATCH`. O tipo distingue job, estágio, trainee, apprenticeship, co-op, contrato, freelance, banco de talentos, edital/bolsa, evento e desconhecido. Evento/curso/bolsa são `NON_JOB_CONTENT`; banco de talentos é revisão.

## Freshness

`CLOSED` é rejeitado. Data ou ano explicitamente antigo gera `STALE`. Uma vaga aberta num ATS oficial continua `OPEN` com alta confiança mesmo sem data pública. Fonte fraca sem data recebe `UNKNOWN_FRESHNESS`, sem inventar encerramento.

## Relação com o Matcher

PreMatch responde “esta oportunidade é plausível para esta intenção?”. Matcher V2 responde “as evidências conhecidas do candidato atendem aos requisitos?”. Technical Match, Evidence Coverage, Confidence e Opportunity Priority não foram redefinidos pelo R2.
