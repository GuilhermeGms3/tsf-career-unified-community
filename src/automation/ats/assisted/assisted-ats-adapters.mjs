import { HostedAtsAdapter } from "../hosted/hosted-ats-adapter.mjs";

class AssistedAtsAdapter extends HostedAtsAdapter {
  constructor(type, version) {
    super(type, version);
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

export class TeamtailorAdapter extends AssistedAtsAdapter {
  static type = "teamtailor";
  static version = "teamtailor-assisted-adapter-v1";
  constructor() { super(TeamtailorAdapter.type, TeamtailorAdapter.version); }
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
  indeed: IndeedAdapter,
  icims: IcimsAdapter,
  taleo: TaleoAdapter,
  oracle: OracleAdapter,
  successfactors: SuccessFactorsAdapter,
  personio: PersonioAdapter,
  teamtailor: TeamtailorAdapter,
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
