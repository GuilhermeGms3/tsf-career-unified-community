# Submission Consent

O consentimento é explícito, curto, específico para uma Application, ResumeVersion, snapshot de respostas e snapshot de preflight. A interface separa “Autorizar envio” da confirmação “Enviar candidatura”.

O cliente envia apenas `confirmed` e o `preflightId` exibido. Target, adapter e caminho do currículo são resolvidos pelo backend. Um preview ausente, vencido ou substituído não pode gerar consentimento.

O token aleatório aparece uma única vez para o cliente e somente seu SHA-256 é persistido. Tokens expiram, são revogados quando um novo consentimento é criado e são consumidos atomically no começo da tentativa. O token não entra em eventos, logs, receipts ou audit export.
