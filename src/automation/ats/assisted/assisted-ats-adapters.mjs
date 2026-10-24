import { HostedAtsAdapter } from "../hosted/hosted-ats-adapter.mjs";
import { assessAdapterHealth } from "../greenhouse/adapter-health.mjs";
import { detectChallenge } from "../../challenge-detection.mjs";
import { portalSubmitProfile, vaultSubmitEnabled } from "../last-mile/portal-submit-profiles.mjs";
import { findEntry, findFinalButton, progressiveSubmit } from "../last-mile/last-mile-engine.mjs";

// Estado da pagina para a ultima milha: assinatura dos campos e titulos visiveis, desafio humano e campos.
export async function vaultPageState(page) {
  const snapshot = await page.evaluate(() => {
    const visible = (element) => element.getClientRects().length > 0;
    const fields = [...document.querySelectorAll("input:not([type=hidden]):not([type=search]),select,textarea")].filter(visible);
    const headings = [...document.querySelectorAll("h1,h2,h3,legend,[role=dialog] [role=heading]")].filter(visible).map((item) => item.textContent.trim());
    return { fields: fields.length, signature: [location.pathname, ...fields.map((item) => `${item.tagName}:${item.type || ""}:${item.name || item.id || ""}`), ...headings].join("|") };
  });
  return { ...snapshot, challenge: await detectChallenge(page) };
}

class AssistedAtsAdapter extends HostedAtsAdapter {
  constructor(type, version) {
    super(type, version);
    this.submitProfile = portalSubmitProfile(type);
    // Adapter assistido nao tem submit. Portal com Cofre ganha a ultima milha progressiva so com perfil
    // COMPLETE ou liberado por opt-in (CAREER_VAULT_SUBMIT_PROVIDERS); o registry promove o mesmo conjunto.
    if (this.submitProfile && (this.submitProfile.status === "COMPLETE" || vaultSubmitEnabled(type))) this.submit = (page, options = {}) => this.progressiveSubmit(page, options);
  }

  async entryOutsideForm(page) {
    const entry = await findEntry(page, this.submitProfile).catch(() => null);
    return Boolean(entry) && !await entry.evaluate((element) => {
      const form = element.closest("form");
      return Boolean(form && [...form.querySelectorAll("input:not([type=hidden]):not([type=search]),select,textarea")].some((input) => input.getClientRects().length));
    }).catch(() => true);
  }

  // Fronteira do envio: o botao de entrada na pagina da vaga, ou o botao final do formulario logado.
  async findSubmitBoundary(page) {
    if (await this.entryOutsideForm(page)) return findEntry(page, this.submitProfile);
    const final = await findFinalButton(page, this.submitProfile);
    if (!final) throw Object.assign(new Error(`Boundary final ${this.submitProfile.label} ausente.`), { code: `${this.submitProfile.codePrefix}_SUBMIT_BOUNDARY_MISSING` });
    return final.candidate;
  }

  progressiveSubmit(page, options = {}) {
    return this.entryOutsideForm(page).then((entryFirst) => progressiveSubmit(page, this.submitProfile, { ...options, inspect: vaultPageState, entryFirst }));
  }

  // Duas paginas dos Cofres que a inspecao generica chamava de "layout nao suportado":
  // - pagina da vaga com o botao de entrada ("Candidatar-se") fora de formulario: cenario apply-entry,
  //   sem campos a preencher (busca e newsletter da pagina nao sao da candidatura). O clique de entrada
  //   pode enviar, entao fica para o envio com consentimento; aqui ele nunca acontece.
  // - questionario logado sem nome, e-mail ou CV: com a sessao do Cofre o portal ja tem esses dados.
  async inspectApplicationForm(page, options = {}) {
    const inspected = await super.inspectApplicationForm(page, options);
    const schema = inspected.schema, signals = schema?.unsupportedSignals || [];
    if (!this.submitProfile || !signals.some((signal) => ["NO_FORM_FIELDS", "NO_APPLICATION_IDENTITY_FIELDS"].includes(signal))) return inspected;
    if (await this.entryOutsideForm(page)) {
      const warnings = [{ code: "ENTRY_CLICK_MAY_SUBMIT" }, ...(options.sessionApplied ? [] : [{ code: "VAULT_SESSION_MISSING" }])];
      return { ...inspected, fields: [], schema: { ...schema, variant: "apply-entry", fields: [], warnings, unsupportedSignals: [], health: "HEALTHY", compatibilityConfidence: 0.8, unknownFields: 0 } };
    }
    if (options.sessionApplied && inspected.fields.length && !signals.includes("NO_FORM_FIELDS")) {
      const unsupportedSignals = signals.filter((signal) => signal !== "NO_APPLICATION_IDENTITY_FIELDS");
      return { ...inspected, schema: { ...schema, variant: "logged-in-form", ...assessAdapterHealth({ fields: inspected.fields, warnings: schema.warnings || [], unsupportedSignals }) } };
    }
    return inspected;
  }
}

export class IndeedAdapter extends AssistedAtsAdapter {
  static type = "indeed";
  static version = "indeed-assisted-adapter-v1";
  constructor() { super(IndeedAdapter.type, IndeedAdapter.version); }
}

export class IcimsAdapter extends AssistedAtsAdapter {
  static type = "icims";
  static version = "icims-assisted-adapter-v1";
  constructor() { super(IcimsAdapter.type, IcimsAdapter.version); }
}

export class TaleoAdapter extends AssistedAtsAdapter {
  static type = "taleo";
  static version = "taleo-assisted-adapter-v1";
  constructor() { super(TaleoAdapter.type, TaleoAdapter.version); }
}

export class OracleAdapter extends AssistedAtsAdapter {
  static type = "oracle";
  static version = "oracle-assisted-adapter-v1";
  constructor() { super(OracleAdapter.type, OracleAdapter.version); }
}

export class SuccessFactorsAdapter extends AssistedAtsAdapter {
  static type = "successfactors";
  static version = "successfactors-assisted-adapter-v1";
  constructor() { super(SuccessFactorsAdapter.type, SuccessFactorsAdapter.version); }
}

export class PersonioAdapter extends AssistedAtsAdapter {
  static type = "personio";
  static version = "personio-assisted-adapter-v1";
  constructor() { super(PersonioAdapter.type, PersonioAdapter.version); }
}

export class AblerAdapter extends AssistedAtsAdapter {static type="abler";static version="abler-assisted-adapter-v1";constructor(){super(AblerAdapter.type,AblerAdapter.version);}}
export class QuickinAdapter extends AssistedAtsAdapter {static type="quickin";static version="quickin-assisted-adapter-v1";constructor(){super(QuickinAdapter.type,QuickinAdapter.version);}}
export class PandapeAdapter extends AssistedAtsAdapter {static type="pandape";static version="pandape-assisted-adapter-v1";constructor(){super(PandapeAdapter.type,PandapeAdapter.version);}}
export class IelAdapter extends AssistedAtsAdapter {static type="iel";static version="iel-assisted-adapter-v1";constructor(){super(IelAdapter.type,IelAdapter.version);}}
export class SolidesAdapter extends AssistedAtsAdapter {static type="solides";static version="solides-assisted-adapter-v1";constructor(){super(SolidesAdapter.type,SolidesAdapter.version);}}
export class RecruteiAdapter extends AssistedAtsAdapter {static type="recrutei";static version="recrutei-assisted-adapter-v1";constructor(){super(RecruteiAdapter.type,RecruteiAdapter.version);}}
export class ProgramaThorAdapter extends AssistedAtsAdapter {static type="programathor";static version="programathor-assisted-adapter-v1";constructor(){super(ProgramaThorAdapter.type,ProgramaThorAdapter.version);}}
export class RemotarAdapter extends AssistedAtsAdapter {static type="remotar";static version="remotar-assisted-adapter-v1";constructor(){super(RemotarAdapter.type,RemotarAdapter.version);}}
export class InfoJobsAdapter extends AssistedAtsAdapter {static type="infojobs";static version="infojobs-assisted-adapter-v1";constructor(){super(InfoJobsAdapter.type,InfoJobsAdapter.version);}}
export class VagasAdapter extends AssistedAtsAdapter {static type="vagas";static version="vagas-assisted-adapter-v1";constructor(){super(VagasAdapter.type,VagasAdapter.version);}}
export class CathoAdapter extends AssistedAtsAdapter {static type="catho";static version="catho-assisted-adapter-v1";constructor(){super(CathoAdapter.type,CathoAdapter.version);}}
export class GeekHunterAdapter extends AssistedAtsAdapter {static type="geekhunter";static version="geekhunter-assisted-adapter-v1";constructor(){super(GeekHunterAdapter.type,GeekHunterAdapter.version);}}

export const assistedAtsAdapterTypes = Object.freeze({
  empregare:class EmpregareAdapter extends AssistedAtsAdapter {static type="empregare";static version="empregare-assisted-v1";constructor(){super("empregare","empregare-assisted-v1");}},
  indeed: IndeedAdapter,
  icims: IcimsAdapter,
  taleo: TaleoAdapter,
  oracle: OracleAdapter,
  successfactors: SuccessFactorsAdapter,
  personio: PersonioAdapter,
  abler:AblerAdapter,
  quickin:QuickinAdapter,
  pandape:PandapeAdapter,
  iel:IelAdapter,
  solides:SolidesAdapter,
  recrutei:RecruteiAdapter,
  programathor:ProgramaThorAdapter,
  remotar:RemotarAdapter,
  infojobs:InfoJobsAdapter,
  vagas:VagasAdapter,
  catho:CathoAdapter,
  geekhunter:GeekHunterAdapter,
});
