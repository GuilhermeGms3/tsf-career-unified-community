// Ponte entre termos usados em vagas (BR, PT e EN) e conceitos ESCO. Os rotulos oficiais da ESCO sao
// formais ("utilizar software de folha de calculo") e quase nao ha sinonimos em portugues, entao estes
// termos dizem ao matcher qual conceito ESCO uma vaga ou um curriculo estao citando.
// Cada termo vira alias do conceito; singular/plural, "de/da/do" e grafia BR/PT ja sao tolerados.
// Evite termos que aparecem em textos institucionais (ex.: "recrutamento" sozinho em "processo de recrutamento").
export const ESCO_MARKET_TERMS = Object.freeze([
  // Contabilidade, fiscal e financas
  { escoId: "ecc18804-a466-40d9-98b4-fba5cd67dd4b", terms: ["contabilidade", "contabilidade financeira", "contabilidade geral", "escrituração contábil", "escrituração contabilística", "lançamentos contábeis", "bookkeeping"] },
  { escoId: "d669af41-756c-48d9-a286-1443253f54b1", terms: ["fiscalidade", "legislação tributária", "rotinas fiscais", "obrigações fiscais", "apuração de impostos", "tax compliance", "taxation"] },
  { escoId: "4a460161-eaea-4fe2-bd0e-164ccc635be1", terms: ["demonstrações contábeis", "balanço patrimonial"] },
  { escoId: "9d916d7c-89b3-4084-a6d9-e2b0b3091404", terms: ["folha de pagamento", "processamento salarial", "processamento de salários", "departamento pessoal", "payroll"] },
  { escoId: "bb99af26-71ff-4dca-bde7-1eb1f6194426", terms: ["sap", "sap erp", "sap r/3", "sap s/4hana"] },
  // Escritorio e ferramentas
  { escoId: "1973c966-f236-40c9-b2d4-5d71a89019be", terms: ["excel", "microsoft excel", "ms excel", "planilhas", "planilhas eletrônicas", "folhas de cálculo", "google sheets", "spreadsheets"] },
  { escoId: "f683ae1d-cb7c-4aa1-b9fe-205e1bd23535", terms: ["pacote office", "microsoft office", "ms office"] },
  { escoId: "7111b95d-0ce3-441a-9d92-4c75d05c4388", terms: ["gerenciamento de projetos", "gerência de projetos"] },
  // Comercial e atendimento
  { escoId: "15a33d76-4640-438d-ae64-fdc0c1d3eebc", terms: ["atendimento ao cliente", "atendimento a clientes", "atendimento ao público", "apoio ao cliente", "customer support", "customer care"] },
  { escoId: "0c0488b3-fca5-4deb-865b-8dc605c3d909", terms: ["técnicas de vendas", "fechamento de vendas", "argumentação de vendas", "sales techniques"] },
  { escoId: "6d97bf55-6fb6-4795-8282-3ef915ae0bb8", terms: ["prospecção de clientes", "prospeção de clientes", "captação de clientes", "prospecção", "prospecting"] },
  { escoId: "0cb013af-6dd9-4fb2-b34e-63dda1a5cf82", terms: ["operação de caixa", "operador de caixa", "frente de caixa", "caixa registadora", "cash register"] },
  // Marketing
  { escoId: "1605025e-a179-421f-8f35-5b07d182a6b2", terms: ["google analytics", "ga4"] },
  // Logistica
  { escoId: "ab6265f2-a9bf-49e8-a9a5-67cbab4de38b", terms: ["gestão de estoques", "controle de estoques", "gestão de stocks", "controle de inventário", "inventory management", "stock control"] },
  { escoId: "de857fbb-91a6-4a3f-8a47-93a9c1a616c8", terms: ["planejamento de transporte", "planeamento de transportes", "roteirização", "transport planning"] },
  // Recursos humanos
  { escoId: "e437eba1-3e22-41f2-8703-741e94785cba", terms: ["recursos humanos", "gestão de pessoas", "gestão de recursos humanos", "human resources"] },
  { escoId: "496932f1-0b6b-4f73-9432-d95c7ddcd43b", terms: ["recrutamento e seleção", "seleção de candidatos", "talent acquisition"] },
  // Saude
  { escoId: "f98e06f5-a09a-4356-b6a8-d55a7d3c5356", terms: ["cuidados de enfermagem", "assistência de enfermagem", "nursing care"] },
  { escoId: "1fd57242-267e-46df-bd8c-849fdd593a50", terms: ["administração de medicamentos", "administrar medicamentos", "medication administration"] },
  { escoId: "e862fb43-5acd-4d37-a4a2-63684c164932", terms: ["uti", "cuidados intensivos", "terapia intensiva", "unidade de terapia intensiva", "intensive care", "icu"] },
  { escoId: "1c6736c2-77de-419c-9b84-8932e15abc21", terms: ["curativos", "tratamento de feridas", "wound care"] },
  // Restauracao
  { escoId: "fa46ff13-5ad7-4a11-85d6-4b0614e411de", terms: ["segurança alimentar", "higiene e segurança alimentar", "higiene alimentar", "manipulação de alimentos", "food safety"] },
  { escoId: "5ba1d5b9-3f8d-46ca-bf9f-2e9ca65d1350", terms: ["haccp", "appcc"] },
  { escoId: "a78b60d6-6cde-4da6-9c48-39bc7396ab16", terms: ["confecção de sobremesas", "confeção de sobremesas", "preparo de sobremesas"] }
]);
