# Submission Uncertain Reconciliation

Timeout, crash ou confirmação ambígua depois do clique resultam em `SUBMISSION_UNCERTAIN`. O sistema não tenta novamente.

A verificação automática é conservadora e só conclui `SUBMITTED` com evidência explícita. Caso continue incerto, o usuário pode abrir o site e declarar `SENT` ou `NOT_SENT`. `SENT` cria receipt manual sanitizado; `NOT_SENT` encerra a tentativa como `RECONCILED_NOT_SUBMITTED`, libera o lock e exige novo preflight e novo consentimento para qualquer tentativa futura.
