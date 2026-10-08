# EvidenceGuard

EvidenceGuard impede que texto gerado ou editado exceda as evidências selecionadas. No Candidate Knowledge V3, além de conferir IDs/termos permitidos, considera `contextType`, `depth`, verificação e evidência negativa.

Formulações de especialista, responsabilidade ou liderança exigem `OWNED`/`LED`. “Experiência profissional” exige contexto profissional. Violações retornam explicação e bloqueiam o changeset; não são silenciosamente reescritas ou aprovadas.

No Application Engine V2, o gate `RESUME_ARTIFACT` valida a ResumeVersion exata, hash do PDF e status do tailoring/EvidenceGuard antes da preview. Respostas livres continuam `USER_REQUIRED` quando não há evidência suficiente.
