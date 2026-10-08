# Fluxo produtivo de currículo

1. Importe PDF, DOCX ou TXT em **Currículos → Importar currículo**.
2. O backend normaliza o documento e cria uma base real. Resumos com sinais de palavras coladas são substituídos por uma fonte confirmada e marcados para revisão.
3. Na biblioteca, marque uma base como **Padrão**. Ela será usada pelo workspace e pelo Job Hunt, salvo quando você escolher explicitamente outra base para uma vaga.
4. Para uma oportunidade, o tailoring produz primeiro um changeset `REVIEW_REQUIRED`; a UI mostra antes/depois, motivo, EvidenceGuard e scores.
5. Ao aprovar o changeset, a UI enfileira a criação da ResumeVersion específica e faz polling com timeout e erro recuperável.
6. Compare novamente a ResumeVersion imutável no componente compartilhado e aprove ou rejeite explicitamente. `EvidenceGuard` continua bloqueando conteúdo sem suporte factual.
7. Renderize ou repita o render; acompanhe o run e baixe os artefatos reais disponíveis.
8. Consulte histórico de runs e exports.
9. Para candidatura, selecione apenas a ResumeVersion específica, aprovada ou pronta, ligada à análise da vaga.

Não há aprovação automática. Ausência de Tectonic pode produzir LaTeX válido e erro recuperável de compilador; não deve ser apresentada como PDF homologado.
