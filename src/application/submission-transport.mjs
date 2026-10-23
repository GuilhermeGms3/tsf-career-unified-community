import {assertResumeAttached} from "./resume-upload-verification.mjs";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

export class DisabledSubmissionTransport{async submit(){throw Object.assign(new Error("O transporte de submit externo está desativado."),{code:"SUBMISSION_TRANSPORT_DISABLED",phase:"PRE_ACTION"});}}

export class FixtureSubmissionTransport{
  constructor(handler=async()=>({status:"SUBMITTED",receipt:{externalReference:"fixture-reference",confirmationUrl:"https://example.test/confirmation",confirmationText:"Application received"}})){this.handler=handler;this.calls=0;}
  async submit(command){await command.onActionArmed?.();this.calls++;return this.handler(command);}
}

export class AdapterSubmissionTransport{
  constructor({registry,revalidator,store=null,allowExternal=false,allowLocalFixtures=false,confirmationTimeoutMs=10000}={}){Object.assign(this,{registry,revalidator,store,allowExternal,allowLocalFixtures,confirmationTimeoutMs});}
  async captureEvidence(prepared,command,phase){
    try{
      const file=await this.revalidator.browserManager.screenshot(prepared.session,`submission-${phase}`);
      const sha256=createHash("sha256").update(await readFile(file)).digest("hex");
      this.store?.applications.recordEvent(command.applicationId,"SUBMISSION_VISUAL_EVIDENCE_CAPTURED",{submissionAttemptId:command.attemptId,phase,file,sha256});
      return sha256;
    }catch{
      this.store?.applications.recordEvent(command.applicationId,"SUBMISSION_VISUAL_EVIDENCE_FAILED",{submissionAttemptId:command.attemptId,phase});
      return "";
    }
  }
  async submit(command){
    const capability=this.registry.describe(command.adapterType);
    if(!capability.canSubmit)throw Object.assign(new Error("Provider não possui Controlled Submit implementado."),{code:"SUBMISSION_ADAPTER_NOT_CAPABLE",phase:"PRE_ACTION"});
    const target=this.revalidator.resolve(command.applicationId).target;
    if(target.localFixture?!this.allowLocalFixtures:!this.allowExternal)throw Object.assign(new Error("Runtime não autoriza submit para este tipo de target."),{code:"SUBMISSION_RUNTIME_NOT_ALLOWED",phase:"PRE_ACTION"});
    const prepared=await this.revalidator.prepareForSubmit(command.applicationId,{expectedPreflight:command.preflight});
    try{
      await assertResumeAttached(prepared.session.page,prepared.selected.artifact?.contentHash,prepared.mapped);
      await this.captureEvidence(prepared,command,"before");
      await command.onActionArmed?.();
      let outcome;
      try{outcome=await prepared.adapter.submit(prepared.session.page,{onActionTriggered:command.onActionTriggered,confirmationTimeoutMs:this.confirmationTimeoutMs});}
      catch(error){await this.captureEvidence(prepared,command,"uncertain");throw error;}
      const sha256=await this.captureEvidence(prepared,command,outcome.status==="SUBMITTED"?"confirmed":"uncertain");
      if(outcome.receipt&&sha256)outcome.receipt.metadata={...outcome.receipt.metadata,screenshotSha256:sha256};
      return outcome;
    }finally{await this.revalidator.browserManager.close(prepared.session).catch(()=>{});}
  }
  async verify(){return {status:"UNKNOWN",message:"O provider não oferece confirmação posterior segura sem receipt ou ação humana."};}
}
