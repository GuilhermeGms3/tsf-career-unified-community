# Homologação Discovery V4

## Automatizada

- `npm run discovery:v4:validate`
- `npm run community:validate`
- `npm run whatsapp:privacy:validate`
- `npm run runtime:validate`
- `npm test`
- `npm run test:playwright`

## Ambiente real

Exige configuração explícita para Brave e Evolution. Validar separadamente: consulta Brave com quota real, instância Evolution 2.3.7 pareada, grupo controlado allowlisted, uma mensagem de vaga relevante, uma irrelevante, uma privada, uma `fromMe` e replay do mesmo `messageId`. Verificar no SQLite que só o lead relevante mínimo e hashes de recibo foram persistidos.

Health de container, fixtures e mocks não comprovam busca externa, mensagem real, candidatura real ou consentimento de um grupo.
# Evidências V4.1.1

- executar `npm run discovery:v4-1-1:validate`;
- confirmar no Mass que `executionMode` e `sourceClass` são distintos;
- confirmar `connectionState` real antes de declarar WhatsApp conectado;
- extrair o audit ZIP e executar os testes mínimos sem `ERR_MODULE_NOT_FOUND`;
- não declarar Brave, WhatsApp, n8n, Ollama ou ATS externo homologado sem credenciais e chamada real.
