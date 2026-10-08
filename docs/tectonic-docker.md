# Tectonic no Docker

O `Dockerfile` baixa o binario oficial Tectonic 0.17.0 para `amd64` ou `arm64`, confere o SHA-256 publicado no release e instala em `/usr/local/bin/tectonic`.

Durante o build, `scripts/warm-tectonic-cache.mjs` compila fixtures sanitizadas dos quatro templates nos dois idiomas com acesso ao bundle e repete a compilacao com `--only-cached`. Em runtime, o compilador usa `--untrusted --only-cached`, `shell: false`, diretorio isolado e timeout.

Validacao operacional:

```bash
docker compose build app
docker compose up -d
docker compose exec app npm run resume:compiler
docker compose exec app npm run resume:benchmark
```

Uma falha por compilador ausente pode ser reenfileirada na mesma versao aprovada. O retry acrescenta um render run; nao cria outra `resume_version`.
