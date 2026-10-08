# Greenhouse Controlled Submit

O adapter V2.1 inspeciona campos, preenche somente mapeamentos conhecidos, valida requeridos e localiza a boundary final. Para enviar, deve existir exatamente um botão final visível e inequívoco no formulário. Ausência ou ambiguidade bloqueia antes da ação.

Targets externos aceitos são exclusivamente HTTPS em `boards.greenhouse.io` ou `job-boards.greenhouse.io`, sem credenciais na URL e com identidade compatível com a vaga persistida. Lever, Ashby, Gupy, Generic e Workday não usam este caminho.

Inspeção, preenchimento, validação e preview não acionam submit. O clique único ocorre apenas dentro de `submit()`, depois de registrar `SUBMIT_ACTION_TRIGGERED`.
