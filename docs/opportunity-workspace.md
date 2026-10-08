# Opportunity Workspace

`/opportunities/:id` é a unidade central de decisão da Experience V2.

## Abas

- **Resumo**: contexto da vaga, quatro sinais independentes, status e próxima ação.
- **Análise**: requisitos por evidência, parcial, lacuna e desconhecido; blockers e gaps.
- **Currículo**: recomendação de base e arquétipo, preparação e revisão estruturada.
- **Candidatura**: método, ATS, capacidade do adaptador, versão exata e ação segura.
- **Histórico**: descoberta, análise, versões e eventos com proveniência.

O read model `GET /api/opportunities/:id/workspace` compõe repositórios existentes. Ele não persiste estado, não recalcula transições e não usa LLM para escolher a próxima ação.

Quando existe um tailoring concluído, o read model também expõe `resumeTailoring`. A aba **Currículo** mostra o changeset factual, EvidenceGuard e scores antes/depois. A aprovação humana do changeset usa o contrato existente de revisão e só então enfileira a criação da `ResumeVersion`; essa versão continua em `REVIEW_REQUIRED` e exige uma segunda revisão explícita antes de preparar a candidatura.

## Semântica dos sinais

- **Technical Match**: aderência calculada pelo matcher do Career Unified.
- **Confiança**: suficiência e consistência dos sinais usados.
- **Elegibilidade**: knockout/prescreen; pode ser elegível, bloqueada ou desconhecida.
- **Opportunity Priority**: score interno de ordenação com match, frescor, preferências, qualidade e esforço.
- **Compatibilidade do documento com ATS**: extração/estrutura/parseabilidade que o produto realmente verifica.

Nenhum desses sinais é apresentado como score nativo de Greenhouse, Gupy, Workday ou outro fornecedor.

## Experience V2.1

Análises legadas continuam legíveis e recebem recomendação explícita de reanálise. Criar candidatura exige uma `ResumeVersion` exata em estado aprovado/pronto; a candidatura guarda esse vínculo e o plano usa a análise selecionada, sem inferir silenciosamente outra versão.

No V4, “Analisar agora” mantém loading e erro no próprio workspace e atualiza a leitura persistida sem recarregar a página. A execução determinística continua válida sem Ollama. Leads comunitários só aparecem como oportunidade depois de promoção humana e fatos mínimos.

Na V4.1, “Analisar agora” funciona sem currículo. O workspace mostra Technical Match, confiança, elegibilidade, prioridade e Document ATS Compatibility separadamente; sem documento, a última fica `NOT_EVALUATED`.

## Evidence Gap Resolution

No Candidate Knowledge V3, requisito de competência em `UNKNOWN` pode expor um CTA de resolução. A escolha abre Conhecimento/Revisões no gap exato, diferencia curso, lab, projeto, profissional e negativa, exige confirmação e dispara reanálise. A análise anterior permanece no histórico. A aba Currículo mostra contexto e depth das evidências que sustentam cada mudança.
