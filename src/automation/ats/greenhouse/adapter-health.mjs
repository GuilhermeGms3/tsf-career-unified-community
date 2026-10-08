export function assessAdapterHealth({fields=[],warnings=[],unsupportedSignals=[]}={}){
  const required=fields.filter(f=>f.required);const unknown=required.filter(f=>f.semanticKey==="CUSTOM.QUESTION"||Number(f.confidence||0)<0.6);
  const critical=unsupportedSignals.length||(!fields.length);const ratio=required.length?unknown.length/required.length:0;
  const health=critical?"UNSUPPORTED":warnings.length||unknown.length?"DEGRADED":"HEALTHY";
  return {health,compatibilityConfidence:health==="HEALTHY"?0.98:health==="DEGRADED"?Math.max(0.6,1-ratio):Math.max(0.1,0.5-ratio),unknownFields:unknown.length,unsupportedSignals};
}
