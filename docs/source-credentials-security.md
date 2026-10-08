# Segurança das credenciais de fontes

O SQLite armazena somente `credential_ref`, provider, tipo, dica mascarada, status e timestamps. O segredo é cifrado com AES-256-GCM, IV aleatório de 96 bits, tag autenticada e AAD ligada à versão/ref. O ciphertext fica em `data/source-credentials.vault.json`, ignorado e excluído do audit export.

A master key fica separada: no Docker, volume nomeado `source_credential_keys` montado em `/run/career-unified-secrets`; localmente, `%USERPROFILE%/.career-unified/source-credentials.key`. Também pode ser fornecida em base64 por variável de runtime. Chave e ciphertext não são exportados, versionados nem guardados juntos.

O fluxo testa a credencial candidata em chamada mínima antes de salvar. Falhas diferenciam inválida, rate limited e provider indisponível sem logar o valor. Troca cria novo ref e remove o ciphertext anterior após metadata persistida; remoção apaga os dois. A API nunca retorna plaintext.

Limite operacional: proteção local não substitui um KMS/secret manager de produção, backup seguro da chave ou controle de acesso do host.
