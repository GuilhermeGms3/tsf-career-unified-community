# Candidate Knowledge V3

Candidate Knowledge é a autoridade profissional canônica. Preferências descrevem o que o candidato procura; o Career Evidence Graph descreve o que ele sabe, fez, estudou ou entregou; `ResumeVersion` é somente uma projeção revisável desse conhecimento.

## Capacidades

- inventário de experiências, projetos, formação, cursos, laboratórios e certificações;
- múltiplas evidências por competência, com contexto, profundidade, uso, período, origem, verificação e política de reuso;
- enriquecimento narrativo determinístico que sempre produz proposta `REVIEW_REQUIRED`;
- resolução de gaps a partir do Opportunity Workspace, seguida de nova análise sem apagar o histórico;
- projeção em Matcher V2, Resume Tailor, EvidenceGuard e perguntas de candidatura.

O fluxo funciona sem Ollama. Uma camada semântica pode sugerir itens futuramente, mas nunca pode promover uma sugestão para fato confirmado. Currículo importado continua `SYSTEM_EXTRACTED` até revisão humana.

## Limites

Não fazem parte deste marco LinkedIn, Workday, Matcher V3, ML personalizado ou autoaprovação. O Application Engine V2 passou a consumir o grafo em seus gates; Gupy V1 consome respostas confirmadas, mas ambos param antes de submit externo. Dados pessoais não entram em logs nem no audit ZIP.
