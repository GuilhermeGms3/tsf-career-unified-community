# Search Intent e Mass Hunt

`SearchIntent` representa intenção profissional, não uma palavra exata. Ele persiste versão, famílias, termos adicionais, senioridades e política de localização. `expanded_queries` guarda consulta, motivo, origem e versão, permitindo auditar o plano executado.

O catálogo extensível contém famílias de infraestrutura, NOC/redes, suporte, estágio em software, backend, frontend, full stack, DevOps, dados e segurança. Aliases determinísticos PT-BR/EN são deduplicados; `INTERNSHIP` é diferente de `JUNIOR`.

`locationPolicy` separa `location`, `workModel` (`ONSITE`, `HYBRID`, `REMOTE`) e `remoteScope`. Assim, presencial/híbrido em Brasília e remoto Brasil podem ter prioridades diferentes sem aceitar presencial fora da área.

`QueryBudgetPolicy` limita queries, requests, concorrência, timeout e retries. A UI mostra uma prévia das consultas e oferece busca manual com budget pequeno antes de ativar recorrência. Mass Hunt significa busca ampla controlada, nunca candidatura em massa.
# Atualização R2 — query tiers e proveniência

Aliases de família são `TIER_1`; termos específicos e termos amplos contextualizados são `TIER_2`; termos amplos crus são `TIER_3`. O budget consome os tiers nessa ordem. ATS estruturados são consultados uma vez por target, enquanto fontes de busca continuam por query/localização. O relatório e a proveniência da vaga preservam query, tier, motivo, origem e família.
# Consumo pelo Source Center V2

Recomendações de empresas usam a versão persistida do Search Intent do perfil ativo (ou primeiro perfil disponível) como filtro de plausibilidade. Não alteram o intent e não executam o Matcher completo.

# Atualização v7 — alinhamento DevOps/SRE

`DEVOPS_SRE` cobre títulos explícitos como DevOps, SRE, Site Reliability e DevSecOps. Títulos como Platform Engineer, Cloud Engineer, Infrastructure Engineer, Production Engineer e Reliability Engineer permanecem ambíguos: entram na expansão de discovery, mas só são classificados nessa família quando título, descrição e requisitos fornecem contexto suficiente, como Terraform, Kubernetes, CI/CD, GitOps, IaC ou observabilidade.

O versionamento é do registro persistido, não do schema SQLite. Salvar o perfil existente uma vez incrementa o intent v6 para v7, substitui as queries daquela versão e preserva localização, senioridade, thresholds, fontes, agenda e estado pausado. Nenhuma migration é necessária.
