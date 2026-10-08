# Auditoria de referências AutoApply — 2026-10-06

## Escopo

Foram avaliados projetos públicos citados como referência para ampliar adapters. A auditoria separa padrões de preenchimento de autoridade de envio: código que encontra campos ou clica em um botão não comprova uma candidatura.

## Resultado

- `geckguy/AutoApply` (MIT) oferece bons padrões de detecção e preenchimento para Workday, Greenhouse, Lever, Ashby, iCIMS, SmartRecruiters, Taleo e Oracle, mas declara que nunca envia a candidatura. É referência para `ASSISTED_FILL`, não para recibo.
- `AbhishekMandapmalvi/AutoApply` (MIT) possui adapters para LinkedIn, Indeed, Workday, Greenhouse, Lever e Ashby. O clone temporário foi auditado e removido. Alguns caminhos retornam sucesso imediatamente após o clique; o adapter Ashby também assume sucesso quando não encontra erro. Esses trechos não foram portados porque violam a regra TSF de confirmação positiva.
- `LangHire` declara cobertura ampla por agente e memória procedural. A alegação de cobertura não substitui contrato determinístico, licença auditada por arquivo e testes de idempotência/recibo por ATS; nenhum código foi copiado nesta rodada.

## Decisão

O TSF preserva seu núcleo existente: clique único, preflight fresh, currículo exato, consentimento, idempotência, `UNCERTAIN` sem retry e recibo sanitizado. Seletores externos só podem ser adaptados quando passarem por fixtures locais e homologação individual. Workday, Indeed e portais autenticados continuam assistidos enquanto login, etapas e confirmação não forem comprovados sem contornar CAPTCHA, MFA ou verificação.
