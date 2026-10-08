# Compilador LaTeX no Windows

## Escolha: Tectonic

O Career Hub usa Tectonic porque a documentacao oficial o distribui como um unico executavel para Windows, macOS e Linux. Em comparacao, TeX Live/MiKTeX com `latexmk` adicionaria uma distribuicao grande e uma superficie operacional desnecessaria para tres templates controlados.

Referencias oficiais:

- instalacao: <https://tectonic-typesetting.github.io/book/latest/installation/>
- `tectonic -X compile`: <https://tectonic-typesetting.github.io/book/latest/v2cli/compile.html>

Baixe o executavel somente da pagina oficial/release e coloque `tectonic.exe` no `PATH`, ou defina `RESUME_TECTONIC_PATH` com o caminho absoluto. O Hub nao baixa executaveis nem pacotes automaticamente.

## Diagnostico

Com o Hub iniciado:

```powershell
npm run resume:compiler
```

Estados: `HEALTHY`, `NOT_INSTALLED`, `MISCONFIGURED` ou `FAILED`. Sem executavel, LaTeX funciona e PDF fica indisponivel.

## Modo seguro e offline

Cada render usa processo direto, sem shell, em pasta temporaria controlada, com timeout e limite de log:

```text
tectonic -X compile --untrusted --only-cached --outdir <version-dir> resume.tex
```

Tambem sao definidos `TECTONIC_UNTRUSTED_MODE=1` e `SOURCE_DATE_EPOCH=0`. `--untrusted` desativa recursos inseguros conhecidos, incluindo shell escape; `--only-cached` proibe download durante o render. O cache Tectonic deve ser preparado administrativamente antes do uso offline. O Hub nunca habilita `-Z shell-escape`.

## Troubleshooting

- `PDF_COMPILER_NOT_AVAILABLE`: confirme `PATH`/`RESUME_TECTONIC_PATH` e reinicie o Hub.
- recurso ausente com `--only-cached`: prepare o cache fora do render usando fonte confiavel; nao remova o modo offline em producao.
- `PDF_COMPILER_TIMEOUT`: o processo foi encerrado; revise o log controlado e o template.
- `PDF_VALIDATION_FAILED`: confirme texto extraivel, nome, secoes e limite de paginas. A fonte `.tex` continua disponivel.

O Dockerfile nao instala Tectonic. Em containers, monte/configure executavel e cache administrados externamente se PDF local for necessario; a imagem padrao permanece pequena.
