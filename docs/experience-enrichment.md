# Experience Enrichment

Na aba Conhecimento, o usuário pode cadastrar/editar/encerrar uma experiência ou projeto e informar responsabilidades, conquistas e tecnologias. Em seguida pode narrar o que fez.

O backend limita e normaliza a entrada, fixa o contexto pela entidade quando disponível e executa extração determinística. O resultado é uma `experience_enrichment_proposal` em `REVIEW_REQUIRED`. A interface mostra cada competência, uso, contexto e depth; o usuário edita, desmarca, confirma selecionados ou rejeita. Apenas itens explicitamente selecionados criam fatos/evidências `USER_CONFIRMED`.

Não existe “aprovar tudo” invisível. Rejeição gera auditoria e não altera conhecimento. O fallback determinístico mantém o fluxo utilizável quando Ollama está indisponível.
