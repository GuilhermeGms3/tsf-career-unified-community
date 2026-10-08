# Gupy Application Adapter V1

O adapter reconhece identidade estável em `*.gupy.io/jobs/{id}` e `*.gupy.io/candidates/jobs/{id}/apply`, inspeciona formulários, mapeia campos conhecidos, preenche componentes suportados e valida sem clicar no boundary final.

Suporta campos textuais conhecidos, select, radio, upload identificado e páginas multi-step detectáveis. Perguntas desconhecidas, knockout e sensíveis ficam `USER_REQUIRED`. Login, MFA, CAPTCHA, anti-bot e verificações são handoffs humanos; não há bypass nem captura de senha/cookie.

Mudança de DOM degrada a saúde em vez de adivinhar. `submit()` lança `GUPY_SUBMIT_NOT_HOMOLOGATED`; a capability pública é `READY_TO_SUBMIT_MANUAL`, `canSubmit=false`.

Validação sintética: `npm run gupy:validate`.
