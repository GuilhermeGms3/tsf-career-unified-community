# Frontend Feature Inventory

## Arquitetura entregue

| Camada                 | Diretório                            | Responsabilidade                                                          |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Bootstrap              | `public/app/`                        | inicialização, navegação, roteamento e primitives visuais                 |
| Cliente HTTP           | `public/api/`                        | erros e contratos HTTP compartilhados                                     |
| Features               | `public/features/`                   | páginas por domínio, sem regra de domínio duplicada                       |
| Componentes existentes | `public/components/`                 | componentes reutilizáveis anteriores, mantidos para evolução incremental  |
| Estilos                | `public/styles/`                     | tokens, base, layout, componentes, features, responsividade e utilitários |
| Read models            | `src/product/experience-service.mjs` | composição determinística para workspaces                                 |
| Próxima ação           | `src/product/next-action-engine.mjs` | recomendação determinística por estado real                               |

## Rotas de produto

| Rota                      | Superfície                                                                          | Deep link |
| ------------------------- | ----------------------------------------------------------------------------------- | --------- |
| `/`                       | Hoje / Decision Inbox                                                               | Sim       |
| `/opportunities`          | Discover, Priority, All, Companies, History                                         | Sim       |
| `/opportunities/:id`      | Summary, Analysis, Resume, Application, History                                     | Sim       |
| `/autopilot`              | Profiles, Sources, Companies, Notifications, Runs                                   | Sim       |
| `/autopilot/profiles/:id` | Perfil de busca (rota reservada/estável)                                            | Sim       |
| `/resumes`                | Library, Review, Versions, Templates, History                                       | Sim       |
| `/resumes/:id`            | Versão e artefatos                                                                  | Sim       |
| `/applications`           | Pipeline, Pending, Interviews, Follow-ups, History                                  | Sim       |
| `/applications/:id`       | Summary, Form, Questions, Resume, Attempts, Timeline                                | Sim       |
| `/knowledge`              | Profile, Skills, Experience, Education, Projects, Preferences, ATS Answers, Pending | Sim       |
| `/settings`               | General, Intelligence, Data, Integrations, Diagnostics, Security                    | Sim       |

## Estados transversais

- Loading de rota e ações assíncronas com botões desabilitados.
- Vazio com orientação contextual e CTA quando aplicável.
- Erro com mensagem do contrato e retry.
- Dados parciais no Autopilot via `Promise.allSettled`.
- Configuração necessária em integrações e inteligência.
- Status de sucesso via região `aria-live`.
- Responsive QA em wide desktop, 1366×768, tablet e mobile.
