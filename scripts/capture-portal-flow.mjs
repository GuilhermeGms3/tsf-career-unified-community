// Captura guiada do fluxo de candidatura de um portal com Cofre, para completar o perfil de ultima milha.
// Uso: npm run capture:portal -- --provider=catho --url=<pagina da vaga> [--out=data/captures] [--redact="Nome,outro"]
//      [--hub=http://127.0.0.1:7123] [--max-minutes=30]
// Abre um navegador novo (sem sessao do TSF). Voce faz login, preenche e envia; o script so observa.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PORTAL_SUBMIT_PROFILES } from "../src/automation/ats/last-mile/portal-submit-profiles.mjs";
import { profileHostAllowed } from "../src/automation/ats/last-mile/last-mile-engine.mjs";
import { captureFlow } from "../src/automation/capture/portal-flow-capture.mjs";

const arg = (name, fallback = "") => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = arg("provider").toLowerCase(), url = arg("url"), profile = PORTAL_SUBMIT_PROFILES[provider];
const usage = (message) => { console.error(`${message}\nUso: npm run capture:portal -- --provider=<${Object.keys(PORTAL_SUBMIT_PROFILES).join("|")}> --url=<pagina da vaga no portal>`); process.exit(2); };
if (!profile) usage(`Portal desconhecido: "${provider}".`);
if (!profileHostAllowed(profile, url)) usage(`A URL precisa ser https e de um host oficial de ${profile.label} (${profile.hosts.join(", ")}).`);

// Dados do perfil local entram na redacao; sem o Hub, so os padroes (e-mail, telefone, CPF, CEP) e --redact.
async function profileRedactions(hub) {
  try {
    const response = await fetch(`${hub.replace(/\/$/, "")}/api/profile`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const personal = (await response.json()).personal || {};
    return ["fullName", "email", "phone", "city", "postalCode", "linkedin", "github", "portfolio"].map((key) => personal[key]).filter(Boolean);
  } catch { return []; }
}

const fromHub = await profileRedactions(arg("hub", "http://127.0.0.1:7123"));
const redact = [...arg("redact").split(",").map((value) => value.trim()).filter(Boolean), ...fromHub];
const outDir = path.resolve(root, arg("out", path.join("data", "captures")), `${provider}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
console.log(`Capturando ${profile.label} em ${path.relative(root, outDir)}`);
console.log(fromHub.length ? "Dados do seu perfil no TSF serão mascarados nas capturas." : "Hub indisponível: só e-mail, telefone, CPF, CEP e --redact serão mascarados. Revise os arquivos antes de compartilhar.");
console.log("No navegador que abriu: faça login, preencha e envie a candidatura normalmente. O script não clica nem digita.");
console.log("Feche o navegador depois que a confirmação do portal aparecer.\n");

const browser = await chromium.launch({ headless: false });
const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Number(arg("max-minutes", "30")) * 60000);
try {
  const page = await (await browser.newContext()).newPage();
  browser.on("disconnected", () => controller.abort());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const { steps, proposal } = await captureFlow(page, { outDir, provider, redact, signal: controller.signal, onStep: (step) => console.log(`etapa ${step.index}: ${step.title || step.page} (${step.buttons.length} botões, ${step.fields.length} campos)`) });
  console.log(`\n${steps.length} etapas salvas. Proposta de perfil:`);
  console.log(JSON.stringify(proposal, null, 2));
  if (!proposal.ready) console.log("\nProposta incompleta: confira se a tela de confirmação apareceu antes de fechar o navegador.");
} finally {
  clearTimeout(timer);
  await browser.close().catch(() => {});
}
