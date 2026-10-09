# Autoridade de capability de candidatura

`src/automation/ats/adapter-registry.mjs` é a única autoridade para o que o Application Engine pode inspecionar, preencher ou enviar. A API `GET /api/experience/application-capabilities` e os workspaces de oportunidade/candidatura projetam exatamente esse registro.

| ATS | Nível | Inspeciona | Preenche | Envia |
| --- | --- | ---: | ---: | ---: |
| Greenhouse | `CONTROLLED_SUBMIT` | sim | sim | sim, com gates |
| Lever | `CONTROLLED_SUBMIT` | sim | sim | sim, com gates |
| Ashby | `CONTROLLED_SUBMIT` | sim | sim | sim, com gates e runtime habilitado |
| Generic | `ASSISTED_FILL` | sim | sim | não |
| SmartRecruiters, Workable, Nerdin e Teamtailor | `CONTROLLED_SUBMIT` | sim | sim | sim, com gates e runtime habilitado |
| IEL, Sólides, Recrutei, ProgramaThor e Remotar | `ASSISTED_FILL` | sim | sim | não |
| InfoJobs, Vagas.com.br, Catho e GeekHunter | `ASSISTED_FILL` | sim | sim | não |
| Gupy | `READY_TO_SUBMIT_MANUAL` | sim | sim | não |
| Workday | `ASSISTED_FILL` | sim | sim, por etapa | não |
| Indeed | `ASSISTED_FILL` | sim | sim | não |
| iCIMS, Taleo, Oracle Recruiting, SuccessFactors e Personio | `ASSISTED_FILL` | sim | sim | não |
| Abler, Quickin e Pandapé | `ASSISTED_FILL` | sim | sim | não; login, identificação ou fluxo ainda não homologado |
| Unknown | `MANUAL` | não | não | não |

O Controlled Submit do Teamtailor aceita somente páginas de vaga em hosts oficiais `*.teamtailor.com` e `*.careers-page.com`. Domínios customizados, login, CAPTCHA, MFA, formulários ainda não carregados ou confirmação ausente interrompem o envio. Um clique sem confirmação observável termina em `SUBMISSION_UNCERTAIN` e nunca é repetido automaticamente.

Capability de discovery é um domínio distinto: detectar um ATS ou buscar vagas não concede autoridade para preencher ou enviar candidatura.

O destination resolver também não concede autoridade. Ele apenas separa a origem da descoberta do destino real da candidatura e entrega esse destino ao registry. Destino conhecido com `canFill=true` pode usar o preenchimento assistido; `canSubmit=true` continua restrito a adapters dedicados e homologados.

Os adapters assistidos internacionais e brasileiros usam o mesmo Candidate Knowledge, EvidenceGuard, upload e validação estrutural do fluxo existente. Cada portal brasileiro reconhecido preserva agora sua identidade no adapter e na telemetria, mesmo quando reutiliza o preenchimento hospedado. Eles não possuem método `submit`; autenticação, CAPTCHA, MFA, mudança de etapa e envio final continuam sob controle humano até existir revalidação fresca, confirmação positiva e recibo por ATS.

Perguntas obrigatórias não mudam essa autoridade. Uma resposta confirmada pelo WhatsApp pode destravar o preenchimento, mas não promove o provider para `CONTROLLED_SUBMIT`. O clique final continua dependendo exclusivamente deste registry e do revalidador homologado.
