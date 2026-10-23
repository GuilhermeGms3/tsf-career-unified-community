const normalized = value => String(value ?? "").trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function validateFormAnswer(field, value) {
  const type = field.fieldType || field.type;
  if (["select-multiple","checkbox-group"].includes(type) && field.options?.length) {
    const values=Array.isArray(value)?value:String(value).split("|").map(item=>item.trim()).filter(Boolean),answers=[];
    for(const value of values){const matches=field.options.filter(option=>normalized(option.value)===normalized(value)||normalized(option.label)===normalized(value));if(matches.length!==1)return {valid:false,reason:"Escolha somente opcoes do formulario; separe varias por |."};answers.push(matches[0].value);}
    return answers.length?{valid:true,value:[...new Set(answers)]}:{valid:false,reason:"Selecione ao menos uma opcao."};
  }
  if (type === "checkbox") {
    if(typeof value==="boolean")return {valid:true,value};
    if(["sim","true","1","nao","false","0"].includes(normalized(value)))return {valid:true,value:["sim","true","1"].includes(normalized(value))};
    return {valid:false,reason:"Responda sim ou nao."};
  }
  if (["select-one","radio-group","radio","combobox"].includes(type) && field.options?.length) {
    const matches = field.options.filter(option => normalized(option.value) === normalized(value) || normalized(option.label) === normalized(value));
    if (matches.length !== 1) return { valid: false, reason: "Escolha exatamente uma das opções do formulário." };
    return { valid: true, value: matches[0].value };
  }
  if (type === "number") {
    const number = String(value ?? "").trim().replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(number) || !Number.isFinite(Number(number)))
      return { valid: false, reason: "Este campo exige um número, sem texto adicional." };
    return { valid: true, value: number };
  }
  return { valid: true, value };
}
