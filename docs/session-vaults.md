# Cofres de sessão

`Cofres` separa autenticação de candidato da descoberta pública de vagas. Uma fonte pode continuar encontrando vagas sem que exista uma conta conectada; a sessão só é consumida quando o destino final da candidatura exigir autenticação.

## Portais gerenciados

- Gupy
- Indeed
- Sólides Vagas
- Recrutei
- IEL Carreiras
- InfoJobs
- Catho
- Vagas.com.br
- ProgramaThor
- GeekHunter
- EMPREGARE.com

Workday permanece contextual por empresa e é solicitado durante a preparação da candidatura. LinkedIn continua sem sessão gerenciada pelo TSF.

Perguntas, limites e auditoria dos onze Cofres: [AutoApply de 18/10/2026](vault-autoapply-audit-2026-10-18.md).
Sessao conectada nao concede AutoSubmit ao adapter: EMPREGARE e os demais
assistidos mantem envio manual ate existir ultima milha propria homologada.

## Fluxo

1. O usuário escolhe **Entrar** ou **Criar conta** em `Cofres`.
2. O backend emite um handoff local, curto e de uso único.
3. O auxiliar abre uma instalação local do Chrome em um perfil temporário exclusivo.
4. Senha, CAPTCHA, MFA e confirmação por e-mail são concluídos pelo usuário diretamente no portal.
5. O runner exige evidência positiva de autenticação e envia somente cookies/origens pertencentes ao portal.
6. O backend revalida a sessão em um segundo contexto antes de armazená-la.
7. O estado mínimo é cifrado com AES-256-GCM pelo `CredentialVault`; SQLite guarda apenas referência, status e datas.
8. O perfil temporário é destruído. Sessões expiram, podem ser verificadas e podem ser desconectadas individualmente.

A validade local padrão é de sete dias, limitada pela expiração real mais curta dos cookies persistentes do portal. Cookies de sessão não ampliam esse limite. O TSF faz revalidação silenciosa e sempre verifica a sessão novamente antes do AutoApply; uma revogação do portal prevalece sobre a validade local.

O sistema não lê perfis normais do navegador, não acessa cofres de senha e não tenta contornar desafios humanos.

## Contratos

- `GET /api/vaults`: catálogo e estado local dos cofres.
- `POST /api/vaults/:provider/connect`: abre login oficial.
- `POST /api/vaults/:provider/create`: abre cadastro oficial.
- `POST /api/vaults/:provider/check`: revalida uma sessão ativa.
- `POST /api/vaults/:provider/disconnect`: remove somente a sessão desse portal.

O protocolo `career-unified-auth://` continua local e precisa ser instalado explicitamente com `scripts/install-source-auth.ps1`.

## Limites operacionais

Os portais podem mudar URL, cookies, textos e desafios. Uma policy no registry habilita o fluxo, mas uma sessão somente vira `SESSION_ACTIVE` depois da evidência positiva e da revalidação. Falha, CAPTCHA pendente, MFA pendente, e-mail pendente ou evidência ambígua mantêm a operação em estado humano, sem fabricar sucesso.

Um cofre ausente, expirado ou revogado nunca interrompe o Mass Hunt inteiro. Descobertas públicas e providers que não exigem autenticação continuam operando; somente a coleta autenticada ou a candidatura daquele destino entra em `WAITING_USER`.
