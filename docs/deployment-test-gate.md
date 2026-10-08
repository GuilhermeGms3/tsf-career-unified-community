# Deployment Test Gate

O workflow local possui um job de teste obrigatório antes do deploy. Ele instala Node 22 e Chromium, executa syntax check, validadores Application V2/Controlled Submit/Candidate Knowledge/Resume/ATS e a suíte completa. O deploy declara `needs: test` e não inicia quando o gate falha.

Esse gate valida código; a liberação externa continua dependendo do kill switch explícito no ambiente de produção. O pipeline não contém segredo nem habilita submit automaticamente.
