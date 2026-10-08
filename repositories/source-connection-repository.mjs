import { randomUUID } from "node:crypto";
import { parseJson } from "./base-repository.mjs";

const now=()=>new Date().toISOString();

export class SourceCredentialRepository {
  constructor(connection){this.connection=connection;}
  get(providerId){const row=this.connection.prepare("SELECT * FROM source_credentials WHERE provider_id=?").get(providerId);return row?this.map(row):null;}
  all(){return this.connection.prepare("SELECT * FROM source_credentials ORDER BY provider_id").all().map(row=>this.map(row));}
  save(item){const timestamp=now(),credentialRef=item.credentialRef||`credential-${randomUUID()}`;this.connection.prepare(`INSERT INTO source_credentials(credential_ref,provider_id,credential_kind,masked_hint,status,validated_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(provider_id) DO UPDATE SET credential_ref=excluded.credential_ref,credential_kind=excluded.credential_kind,masked_hint=excluded.masked_hint,status=excluded.status,validated_at=excluded.validated_at,updated_at=excluded.updated_at`).run(credentialRef,item.providerId,item.credentialKind,item.maskedHint||"",item.status||"CONNECTED",item.validatedAt||timestamp,item.createdAt||timestamp,timestamp);return this.get(item.providerId);}
  remove(providerId){return this.connection.prepare("DELETE FROM source_credentials WHERE provider_id=?").run(providerId).changes>0;}
  map(row){return {credentialRef:row.credential_ref,providerId:row.provider_id,credentialKind:row.credential_kind,maskedHint:row.masked_hint,status:row.status,validatedAt:row.validated_at||"",createdAt:row.created_at,updatedAt:row.updated_at};}
}

export class SourceConnectionEventRepository {
  constructor(connection){this.connection=connection;}
  record({providerId,eventType,outcome,errorCode="",metadata={}}){const allowed={latencyMs:Math.max(0,Number(metadata.latencyMs)||0),status:String(metadata.status||"").slice(0,40),source:String(metadata.source||"").slice(0,40)};const id=`source-event-${randomUUID()}`;this.connection.prepare("INSERT INTO source_connection_events(id,provider_id,event_type,outcome,error_code,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)").run(id,providerId,eventType,outcome,errorCode||null,JSON.stringify(allowed),now());return {id,providerId,eventType,outcome,errorCode,metadata:allowed};}
  list(providerId){return this.connection.prepare("SELECT * FROM source_connection_events WHERE provider_id=? ORDER BY created_at DESC LIMIT 50").all(providerId).map(row=>({id:row.id,providerId:row.provider_id,eventType:row.event_type,outcome:row.outcome,errorCode:row.error_code||"",metadata:parseJson(row.metadata_json,{}),createdAt:row.created_at}));}
}
