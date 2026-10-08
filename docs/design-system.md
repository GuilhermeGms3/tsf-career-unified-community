# Design System — Career Unified Experience V2

## Direção

Workspace editorial de operações pessoais: denso, calmo e confiável. A interface usa superfícies sólidas, divisores finos e hierarquia tipográfica; não usa glassmorphism, gradientes decorativos ou gráficos de vaidade. Os temas claro e escuro compartilham os mesmos tokens semânticos e preservam a mesma hierarquia de informação.

## Tokens principais

| Token       | Valor     | Uso                              |
| ----------- | --------- | -------------------------------- |
| `--ink-950` | `#0f1412` | superfícies técnicas escuras          |
| `--canvas`  | `#f3f5f2` | fundo claro neutro               |
| `--surface` | `#ffffff` | cartões e diálogos               |
| `--text`    | `#17181c` | texto principal                  |
| `--action`  | `#0b7d72` | ações e seleção                  |
| `--sage`    | `#26724b` | sucesso/evidência                |
| `--amber`   | `#9a5b07` | atenção/revisão                  |
| `--coral`   | `#b93d4b` | erro/bloqueio                    |

## Componentes

- Shell lateral agrupado em Trabalho, Automação, Conhecimento e Sistema, com barra móvel.
- Alternância claro/escuro persistida localmente, sem mudar rotas ou capacidades.
- Page header, tabs persistidas na URL e workspace header sticky.
- Cards de decisão, oportunidade, candidatura, política, fonte e conhecimento.
- Status strip, metric grid, definition grid, context rail e timeline.
- Empty, loading, error, partial-data, configuration-required e success toast.
- Dialog nativo com Escape, foco inicial do browser e retorno automático de foco.

## Acessibilidade

- Skip link e `main` focalizado após navegação.
- Navegação e abas com `aria-current`.
- Labels visíveis; regiões de status com `aria-live`.
- Foco de alto contraste; alvos mínimos de 42–44 px.
- Redução de movimento via `prefers-reduced-motion`.
- Layout sem overflow horizontal nos breakpoints suportados.
