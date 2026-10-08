# Application Workspace

O workspace usa uma única Application e organiza Resumo, Formulário/Preparação, Perguntas, Currículo, Preflight, Revisão final, Tentativas e Linha do tempo. Cada aba lê contratos reais do backend; ausência de avaliação ou receipt é mostrada como ausência, não simulada.

O preflight de preview inspeciona o site sem tocar na boundary final. A revisão mostra empresa, vaga, ATS, horário do check, saúde/DOM, ResumeVersion, respostas mascaradas, fontes, duplicata, kill switch, bloqueios e alertas. O consentimento e a ação final são passos separados. Preview desatualizada exige atualização; `SUBMISSION_UNCERTAIN` oferece verificação, abertura do site e reconciliação explícita, nunca retry automático.
