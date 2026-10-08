# Submission Idempotency and Recovery

Cada tentativa exige chave de idempotência única e adquire um lock por candidatura. Repetir a mesma chave reutiliza o resultado; outra chave não atravessa um lock ativo ou incerto.

Chamadas concorrentes com a mesma chave compartilham a mesma promise em voo e produzem no máximo uma boundary action. Reutilizar a chave em outra Application gera conflito de escopo. Depois de `SUBMIT_ACTION_TRIGGERED`, timeout, queda ou confirmação ambígua viram `UNCERTAIN`; não há retry automático.

Na inicialização, locks vencidos antes da ação viram `FAILED`. Locks vencidos depois de `ACTION_TRIGGERED` viram `UNCERTAIN`, preservando a necessidade de reconciliação humana. O limite padrão é cinco tentativas globais por hora e pode apenas ficar mais restritivo pela política.
