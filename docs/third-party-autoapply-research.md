# Pesquisa de implementações externas de AutoApply

Auditoria realizada em 2026-10-05. Os repositórios foram clonados apenas em diretório temporário, sem executar instaladores ou dependências, e removidos após a análise.

| Projeto | Commit auditado | Licença | Uso no TSF |
| --- | --- | --- | --- |
| `geckguy/AutoApply` | `6c5fbc4` | MIT | Referência de cobertura fill-only para Workday, iCIMS, Taleo, Oracle e formulários genéricos. |
| `AbhishekMandapmalvi/AutoApply` | `053071b` | MIT | Referência para distinguir Indeed Apply de redirecionamento externo, limitar etapas e interromper em CAPTCHA. |
| `jaimaann/LangHire` | `e43d8fa` | MIT | Referência conceitual de memória procedural por ATS; arquitetura não transplantada. |
| `strelov1/freehire` | `9816875` | MIT | Referência de descoberta pública direta por ATS, especialmente Oracle Recruiting; nenhum transporte de submit copiado. |

## Decisão de integração

Foram adaptados os padrões de identificação por hostname, separação entre origem e ATS final, preenchimento assistido e bloqueio explícito de submit. Não foi copiado um bot completo nem criada uma segunda máquina de estados.

Foram rejeitados os padrões que:

- armazenam ou reutilizam senha de candidato;
- tentam contornar CAPTCHA, MFA ou proteção anti-bot;
- clicam no envio final sem consentimento e preflight do TSF;
- repetem o clique após timeout;
- consideram navegação ou mudança de texto como recibo suficiente.

Indeed, iCIMS, Taleo, Oracle Recruiting, SuccessFactors, Personio e Teamtailor permanecem em `ASSISTED_FILL`. A promoção individual para `CONTROLLED_SUBMIT` exige fixture representativa, target policy, revalidador final, boundary de ação única, confirmação positiva, recibo e homologação controlada.
