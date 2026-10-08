import {assertResumeAttached} from "./resume-upload-verification.mjs";

export class DisabledSubmissionTransport{async submit(){throw Object.assign(new Error("O transporte de submit externo está desativado."),{code:"SUBMISSION_TRANSPORT_DISABLED",phase:"PRE_ACTION"});}}

export class FixtureSubmissionTransport{
  constructor(handler=async()=>({status:"SUBMITTED",receipt:{externalReference:"fixture-reference",confirmationUrl:"https://example.test/confirmation",confirmationText:"Application received"}})){this.handler=handler;this.calls=0;}
  async submit(command){this.calls++;return this.handler(command);}
}

export class AdapterSubmissionTransport{
  constructor({registry,revalidator,allowExternal=false,allowLocalFixtures=false,confirmationTimeoutMs=10000}={}){Object.assign(this,{registry,revalidator,allowExternal,allowLocalFixtures,confirmationTimeoutMs});}
  async submit(command){const capability=this.registry.describe(command.adapterType);if(!capability.canSubmit)throw Object.assign(new Error("Provider não possui Controlled Submit homologado."),{code:"SUBMISSION_ADAPTER_NOT_CAPABLE",phase:"PRE_ACTION"});const target=this.revalidator.resolve(command.applicationId).target;if(target.localFixture?!this.allowLocalFixtures:!this.allowExternal)throw Object.assign(new Error("Runtime não autoriza submit para este tipo de target."),{code:"SUBMISSION_RUNTIME_NOT_ALLOWED",phase:"PRE_ACTION"});const prepared=await this.revalidator.prepareForSubmit(command.applicationId,{expectedPreflight:command.preflight});try{await assertResumeAttached(prepared.session.page,prepared.selected.artifact?.contentHash,prepared.mapped);await command.onActionArmed?.();return await prepared.adapter.submit(prepared.session.page,{onActionTriggered:command.onActionTriggered,confirmationTimeoutMs:this.confirmationTimeoutMs});}finally{await this.revalidator.browserManager.close(prepared.session).catch(()=>{});}}
  async verify(){return {status:"UNKNOWN",message:"O provider não oferece confirmação posterior segura sem receipt ou ação humana."};}
}
