# Resume Tailoring

`ResumeVersion` é projeção do Candidate Knowledge, não autoridade. A ausência de uma skill no currículo não elimina uma evidência de carreira.

No Candidate Knowledge V3, cada mudança proposta pode carregar IDs do Career Evidence Graph. O review mostra competência, contexto e depth; EvidenceGuard bloqueia claims incompatíveis. A aprovação do changeset e a aprovação da versão continuam gates humanos separados. Currículo importado gera conhecimento `SYSTEM_EXTRACTED/REVIEW_REQUIRED`, nunca `USER_CONFIRMED` silenciosamente.

O consentimento de submission fixa o `resumeVersionId`; trocar ou corromper o artefato invalida o preflight e exige nova revisão/consentimento.

Sem um modelo local configurado, o tailoring continua funcional por meio de tres variantes deterministicas: perspectiva tecnica, experiencia e contribuicao. Todas usam somente evidencias do curriculo e do Candidate Knowledge, sao avaliadas pelo matcher da vaga e a melhor variante segue para o mesmo changeset `REVIEW_REQUIRED`. Objetivos amplos com varias familias de cargo devem ser substituidos por um resumo coerente com a oportunidade; o texto original permanece intacto no curriculo-base.

Quando Ollama ou outro provider local estiver disponivel, sua proposta participa da mesma comparacao com as variantes deterministicas. O provider nao contorna EvidenceGuard, revisao humana ou bloqueio de regressao.

Tailoring direcionado nao e apenas insercao de palavras-chave. Para ser elegivel ao AutoApply, a versao deve reposicionar o resumo e pelo menos uma experiencia ou projeto comprovado para a familia da vaga. O motor compara a proposta da LLM com variantes deterministicas baseadas em evidencia e prefere a alternativa valida com maior profundidade narrativa. Uma mudanca somente no resumo permanece `REVIEW_REQUIRED`.

Responsabilidades encontradas apenas no anuncio, como SLA, causa raiz, base de conhecimento, atendimento consultivo ou atendimento a clientes internacionais, nao podem ser apresentadas como historico do candidato sem evidencia correspondente. JSON quase valido pode receber apenas reparos sintaticos conservadores; o schema, o EvidenceGuard e o quality gate continuam obrigatorios.

## Base aprovada e envio ao WhatsApp

Somente o curriculo marcado simultaneamente como `default_resume_id` e `resumeKind=BASE` pode originar uma nova versao para lote, WhatsApp ou AutoApply. A selecao e revalidada antes de preparar o documento e novamente imediatamente antes de anexar o PDF. Se a base padrao mudar durante o fluxo, a versao pendente e bloqueada e precisa ser regenerada.

Curriculos importados e versoes derivadas continuam servindo como Candidate Knowledge, mas nao podem substituir silenciosamente a base aprovada. No estado operacional atual, essa base e exibida como `BASE 01`.

O conteudo factual e a apresentacao sao autoridades separadas. `BASE 01` fornece os fatos; `BASE_01/base-01-v4` e o template de saida padrao que reproduz o PDF aprovado e preserva email, GitHub e LinkedIn como links clicaveis. `OVERLEAF_BLUE` e `OVERLEAF_CLASSIC` sao escolhas de apresentacao e nunca substituem a base factual.

## Qualidade editorial

O prompt pede portugues brasileiro direto, voz consistente e enfase factual adequada a familia da vaga. Construcoes promocionais ou artificiais como "reune conhecimentos comprovados", "direcionados a" e "base aplicavel a desafios" colocam a versao em revisao e impedem AutoApply automatico.

Na homologacao local de 2026-10-07, `qwen/qwen3-4b-2507` produziu JSON completo e redacao mais natural no mesmo caso em que `google/gemma-4-e4b` consumiu o limite de saida em raciocinio e devolveu conteudo vazio. O Qwen passou a ser o modelo local preferido para tailoring neste ambiente. Essa preferencia nao remove comparacao com variantes deterministicas, EvidenceGuard, quality gate ou revisao visual do PDF.
