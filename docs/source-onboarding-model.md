# Modelo de onboarding de fontes

Tipos canônicos: `NONE`, `TARGET`, `API_KEY`, `TOKEN`, `OAUTH`, `ACCOUNT`, `PARTNER`, `PAIRING`, `MANUAL`, `UNSUPPORTED`.

Estados canônicos: `READY`, `CONNECTED`, `SETUP_REQUIRED`, `ACCOUNT_REQUIRED`, `CREDENTIAL_REQUIRED`, `PARTNER_REQUIRED`, `TARGET_REQUIRED`, `PAIRING_REQUIRED`, `CONFIG_REQUIRED`, `MANUAL_ONLY`, `UNSUPPORTED`, `DEGRADED`, `ERROR`.

O `SourceOnboardingRegistry` contém nome, categoria, tipo, capabilities, requisitos, links oficiais e próxima ação. O backend combina registry, configuração pública, metadata de credential e runtime. O browser apenas renderiza o DTO.

OAuth é representável, mas nenhuma fonte recebe um fluxo OAuth fictício. `PARTNER` informa contratação/acordo; `MANUAL` abre o portal; `UNSUPPORTED` não promete automação.
