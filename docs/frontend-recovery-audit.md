# Frontend Recovery Audit

## Escopo e arquitetura atual

O frontend é uma SPA sem framework, servida por `server.mjs`. A camada visual usa ES Modules em `public/app`, páginas em `public/features`, componentes em `public/components` e CSS global em `public/styles`. O roteador mantém deep links de oportunidades, currículos, candidaturas, lotes e perfis. Dados e regras de domínio continuam nas APIs, serviços e repositórios do backend.

Fluxos críticos preservados:

- Today consome `/api/today`, `/api/source-center` e `/api/product/onboarding`.
- Oportunidades usam projeções resumidas na lista e `/api/opportunities/:id/workspace` no detalhe.
- Currículos usam `ResumeVersion`, `resumeSpec`, tailoring e jobs persistidos.
- Candidaturas mantêm revisão humana, preflight e bloqueios de envio existentes.
- `public/app/background-jobs.js` acompanha geração de currículo sem bloquear a navegação.

## Problemas verificados no baseline

- O shell expunha dez grupos de navegação, incluindo observabilidade, fontes e automação como destinos primários.
- A identidade teal/sage, o monograma circular e as superfícies claras transmitiam aparência de sistema administrativo.
- A tipografia dependia de `Inter` sem carregamento garantido, usava texto relevante em 11 px e letter spacing negativo em títulos.
- A auditoria automática encontrou 29 tokens definidos, 37 usados e 11 referências indefinidas: `--border`, `--danger`, `--ink`, `--muted`, `--space-1` a `--space-5`, `--surface-raised` e `--text-muted`.
- A Home levou aproximadamente 13,3 s para a primeira resposta de `/api/today` no banco atual. O loader ocupa a tela durante esse aquecimento.
- A Home mostrava dez vagas antes das tarefas assíncronas concluídas; resultados importantes ficavam abaixo de grande volume de conteúdo.
- `public/features/opportunities/page.js` tem mais de 1.200 linhas e `public/styles/features.css` mais de 1.100 linhas.
- O detalhe de oportunidade usa cinco abas, status técnico proeminente e rail lateral.
- A revisão de currículo apresenta mudanças e ações, mas não estabelece o currículo completo como visão principal antes da aprovação.

## Arquitetura visual adotada

- Identidade `TSF Career` com base graphite/neutral e indigo como cor de ação. Verde fica reservado a sucesso.
- Navegação principal: Hoje, Vagas, Candidaturas, Currículos e Meu perfil. Ferramentas operacionais ficam em Mais.
- Hierarquia: decisão, compreensão e ação; detalhes técnicos permanecem em disclosure avançado.
- Escala tipográfica baseada em fontes de sistema disponíveis no Windows, sem download externo.
- Tokens semânticos centralizados em `public/styles/tokens.css`, com verificação por `npm run check:css-tokens`.
- Migração progressiva: shell e Home, detalhe de oportunidade, revisão de currículo, páginas centrais e QA.

## Componentes a substituir ou extrair

- Substituir o cabeçalho tabulado do detalhe por workspace vertical.
- Extrair blocos naturais da Home e do detalhe sem criar uma camada abstrata paralela.
- Criar preview semântico de `resumeSpec` e separar currículo, alterações e ações.
- Reutilizar `pageHeader`, `pill`, `tabs`, `icon`, estados de UI, query cache e roteamento existentes.

## Riscos da migração

- O worktree inicial contém alterações não commitadas em frontend, backend e testes. Elas são preservadas na branch `frontend/ux-recovery`.
- Testes antigos podem afirmar labels e estrutura anteriores; só serão atualizados quando representarem a UX substituída.
- O payload e o aquecimento inicial de Today continuam no backend; a recuperação visual não deve duplicar regras no cliente.
- Deep links e ações técnicas precisam continuar acessíveis mesmo fora da navegação principal.
