# Nerdin Controlled Submit

O Nerdin possui um formulário público nativo em três etapas. O adapter dedicado aceita somente URLs oficiais `nerdin.com.br`, deriva a identidade numérica da vaga e converte a página pública para `vaga_candidatura.php?id=<id>`.

O envio exige, sem exceção:

- vaga confirmada como aberta pela página pública de candidatura;
- inspection fresh e estrutura integral reconhecida;
- respostas confirmadas para função, inglês, disponibilidade, regime e pretensões;
- PDF exato aprovado e hash conferido depois do upload;
- consentimento específico, vigente e posterior ao preflight fresh;
- boundary único `Enviar Candidatura`;
- confirmação positiva por texto ou URL para gerar receipt.

O adapter percorre as etapas durante o preenchimento, mas não atravessa o botão final. Ausência de confirmação após o clique produz `SUBMISSION_UNCERTAIN`, sem retry automático. CAPTCHA, mudança de formulário ou campo obrigatório desconhecido interrompem o fluxo.

A fixture automatizada prova clique único, recibo positivo e idempotência no resultado incerto. A inspeção pública confirmou a forma do formulário, mas nenhuma candidatura externa real foi enviada nesta entrega.

Perguntas textuais desconhecidas podem solicitar rascunho à LLM com EvidenceGuard. O usuário precisa revisar e aprovar cada sugestão. Salário, disponibilidade, autorização legal, consentimentos, campos sensíveis e seleções estruturadas nunca recebem resposta automática.
