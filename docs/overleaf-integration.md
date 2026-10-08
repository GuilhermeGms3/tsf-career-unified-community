# Integracao Overleaf

## Resultado da pesquisa oficial

Em agosto de 2026, a documentacao oficial descreve upload manual de arquivos, Git Integration e GitHub Synchronization:

- <https://docs.overleaf.com/managing-projects-and-files/adding-files-to-a-project/uploading-files-to-a-project>
- <https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/git>
- <https://docs.overleaf.com/integrations-and-add-ons/git-integration-and-github-synchronization/github-synchronization>

Git Integration e GitHub Synchronization sao recursos premium. GitHub Sync exige acao do usuario, nao sincroniza automaticamente e nao conecta um projeto Overleaf existente a um repositorio GitHub existente. A documentacao publica consultada nao oferece uma API geral, estavel e oficialmente suportada para o Hub criar projetos e enviar arquivos diretamente.

## Decisao operacional

O provider fica em `EXPORT_ONLY`, com status `OVERLEAF_EXPORT_READY`. O Hub cria `overleaf-export.zip` contendo somente `resume.tex` e `manifest.json` com versao, template, idioma e SHA-256.

Nao entram no bundle: banco SQLite, perfil bruto, evidencias completas, segredos, logs ou tokens. O usuario baixa o ZIP e faz upload manual. Essa opcao nao torna Overleaf dependencia do produto.

Uma integracao Git futura so deve ser habilitada quando o usuario configurar conscientemente um projeto Overleaf existente, um token fora do banco/logs e um plano compativel. Deve usar processo Git sem shell, host fixo `git.overleaf.com`, timeout e revisao explicita. Nao usar endpoints privados, automacao de navegador ou scraping.
