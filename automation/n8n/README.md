# Workflow n8n do Career Unified

O arquivo `workflows/career-whatsapp-alerts.json` é importável e começa **inativo**. Ele não consulta SQLite, não decide elegibilidade e não envia candidaturas. Sua única função é validar o webhook HMAC do Hub e entregar os eventos permitidos pela Evolution API.

Depois de criar o owner do n8n, importe com a interface ou execute explicitamente:

```powershell
npm run automation:n8n:bootstrap -- --confirm
```

Revise as variáveis exclusivas do container n8n, conecte a instância WhatsApp e só então ative o workflow. O segredo não está no JSON versionado. Para ambientes compartilhados, prefira migrar a chave da Evolution para uma credencial Header Auth do n8n e remover o acesso a variáveis no Code node.
