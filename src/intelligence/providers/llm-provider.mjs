export class LlmProvider{
  static type="abstract";
  async generate(){throw new Error("generate() nao implementado.");}
  async generateStructured(){throw new Error("generateStructured() nao implementado.");}
  async classify(input,options={}){return this.generateStructured(input,options);}
  async health(){throw new Error("health() nao implementado.");}
  async listModels(){throw new Error("listModels() nao implementado.");}
  async modelInfo(){throw new Error("modelInfo() nao implementado.");}
}
