# Homologação em ambiente real

Use esta lista separadamente dos testes com fixtures. Um item só pode ser marcado quando houver evidência do ambiente e do destino correto.

## Discovery e candidatura

- [ ] Criar Search Intent real e executar Test Search.
- [ ] Busca curta em fonte pública real, com resultado e diagnóstico registrados.
- [ ] Descobrir uma vaga real e abrir o deep link correto.
- [ ] Analisar a vaga com a versão atual do Matcher.
- [ ] Preparar currículo específico e revisar a ResumeVersion.
- [ ] Preparar candidatura ligada à análise e à ResumeVersion exata.
- [ ] Configurar uma empresa real no Company Radar.
- [ ] Greenhouse real: inspecionar e preencher até revisão final, sem submit.
- [ ] Lever real: inspecionar e preencher até revisão final, sem submit.
- [ ] Ashby real: validar formulário e boundary final; executar submit controlado somente em candidatura autorizada.
- [ ] Confirmar que CAPTCHA, MFA ou consentimento pausam o fluxo.

## Documento

- [ ] Importar documento real autorizado e revisar extração.
- [ ] Aprovar uma ResumeVersion factual.
- [ ] Renderizar PDF real com Tectonic e inspecionar texto/páginas/visual.
- [ ] Confirmar que a candidatura referencia o SHA/artefato da versão exata.

## WhatsApp e n8n

- [ ] Configurar `.env` local sem registrar segredos.
- [ ] Confirmar Evolution, Postgres, Redis e n8n saudáveis.
- [ ] Parear instância real por QR e registrar apenas metadados.
- [ ] Importar/ativar o workflow versionado e validar HMAC/replay.
- [ ] Enviar mensagem de teste somente após conferir o destino mascarado.
- [ ] Gerar um high match controlado e confirmar outbox → n8n → Evolution → WhatsApp.

Testes automatizados e fixtures devem ser relatados como **MOCK/FIXTURE TESTED**. Os itens acima, quando comprovados, são **REAL HOMOLOGATED**.
