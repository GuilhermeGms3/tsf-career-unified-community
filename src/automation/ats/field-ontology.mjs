const rules = [
  ["COVER_LETTER.FILE", /cover letter|carta.*apresentacao/, ["file"]], ["RESUME.FILE", /resume|curriculo|cv\b/, ["file"]],
  ["IDENTITY.FIRST_NAME", /first.?name|nome\b(?!.*completo)/, ["text"]], ["IDENTITY.LAST_NAME", /last.?name|sobrenome/, ["text"]], ["IDENTITY.FULL_NAME", /full.?name|nome completo/, ["text"]],
  ["CONTACT.EMAIL", /e.?mail/, ["email","text"]], ["CONTACT.PHONE", /phone|telefone|celular/, ["tel","text"]],
  ["LOCATION.FULL_ADDRESS", /full address|street address|endereco completo|logradouro/, ["text","textarea"]], ["LOCATION.CITY", /\bcity\b|cidade/, ["text","select-one"]],
  ["LOCATION.STATE", /state|province|estado|uf\b/, ["text","select-one"]], ["LOCATION.COUNTRY", /country|pais/, ["text","select-one"]],
  ["PROFILE.LINKEDIN", /linkedin/, ["url","text"]], ["PROFILE.GITHUB", /github/, ["url","text"]], ["PROFILE.PORTFOLIO", /portfolio|website|site pessoal/, ["url","text"]],
  ["WORK_AUTHORIZATION.AUTHORIZED", /authorized|autorizacao.*trabalh|legally.*work/, ["radio","checkbox","select-one"]], ["WORK_AUTHORIZATION.REQUIRES_SPONSORSHIP", /sponsor|patrocinio|visa/, ["radio","checkbox","select-one"]],
  ["PREFERENCES.SALARY_EXPECTATION", /salary|salario|compensation|remuneracao/, ["text","number","textarea"]]
];

export function mapSemanticField(field) {
  const combined=[field.type,field.label,field.name,field.id,field.placeholder,field.ariaLabel,field.autocomplete,field.nearbyText].filter(Boolean).join(" ").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
  for(const [key,pattern,types] of rules) if(types.includes(field.type)&&pattern.test(combined)){const signals=[];if(pattern.test(String(field.label||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase()))signals.push(`label=${field.label}`);if(field.autocomplete)signals.push(`autocomplete=${field.autocomplete}`);signals.push(`input[type=${field.type}]`);return {semanticKey:key,confidence:Math.min(0.99,0.82+signals.length*0.05),signals};}
  return {semanticKey:"CUSTOM.QUESTION",confidence:0,signals:[]};
}
