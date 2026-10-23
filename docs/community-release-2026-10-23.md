# Atualização Community — 23/10/2026

## Origem e isolamento

Snapshot de código sincronizado com o TSF em `f801030`, sem importar o histórico
Git privado. A instalação pessoal não é alterada. Mantidos README, licença MIT,
política de segurança e padrões geográficos da edição Community.

## Incluído

- Interface atual, Processos, Candidaturas, Cofres e controle de automação.
- Descoberta, deduplicação, ranking e disponibilidade periódica de vagas.
- Geração direcionada de currículo, biblioteca offline e validação de qualidade.
- WhatsApp: central, decisões, perguntas, alterações e feedback de processamento.
- AutoApply e submit progressivo, com autorização, revalidação e recibos.
- Gateway mobile, modos operacionais e controles de proxy confiável.
- Motor Python modularizado e migrations de schema até 058.

## Não incluído

Currículos, documentos, perfil, banco, mensagens, grupos, candidaturas, recibos,
credenciais, chaves, sessões, arquivos de implantação ou histórico operacional
da instalação pessoal. Relatórios datados dessa instalação foram substituídos
por avisos neutros. Fixtures utilizam identidades sintéticas.

Cada instalação começa sem evidências de homologação externa. Implementação de
um adapter não prova candidatura entregue: sessão, formulário, gates e recibo
devem ser validados na própria instalação. Envio externo permanece desativado
em `.env.example`; não houve candidaturas reais para validar esta publicação.

## Primeiro uso

1. Execute o início rápido do README e configure o próprio perfil.
2. Importe seus documentos e aprove o currículo base.
3. Configure regiões, fontes, LLM e integrações que desejar.
4. Conecte cada portal em Cofres com a própria conta.
5. Teste consultas e revisão antes de habilitar agendas ou envio externo.

Portugal continua sendo o padrão. Fontes brasileiras mantêm seu alcance próprio.
Não é necessário inserir dados pessoais no código para utilizar o projeto.

## Validação

- `npm run check:syntax`: 569 arquivos válidos.
- `npm test`: 1.542 testes aprovados, sem falhas ou ignorados.
- `python -m unittest discover -s engine -p "test_*.py"`: 10 aprovados.
- `python -m unittest discover -s scripts -p "test_production_preflight.py"`: 4 aprovados.
- `docker compose config --quiet`: aprovado.
- `node scripts/check-public-release.mjs`: aprovado; não substitui auditoria completa.
- Instalação vazia: Hoje, Vagas, Processos, Cofres e Automação conferidos visualmente;
  navegação sem erros JavaScript ou overflow horizontal, incluindo web em 390px.
- Revisão do snapshot: sem os identificadores pessoais procurados, arquivos
  operacionais privados ou referências ao repositório privado.

Não houve rebuild de imagens Docker, implantação no servidor ou envio externo
nesta atualização. O CI repete as validações automatizadas pertinentes.
