import { createHash } from "node:crypto";
import { zipStored } from "./document-export-service.mjs";

export function safeSegment(value, fallback="artifact") {
  let name=String(value || fallback).normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0,80).replace(/^[.-]+|[.-]+$/g, "") || "artifact";
  if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name=`_${name}`;
  return name;
}

export class BatchExportService {
  constructor({ store }) { this.store = store; }
  async build(batchId) {
    const batch = this.store.resumeBatches.findById(batchId);
    if (!batch) throw Object.assign(new Error("Batch não encontrado."), { code: "RESUME_BATCH_NOT_FOUND", status: 404 });
    const files = [], manifest = { schemaVersion: "resume-batch-export-v1", batchRunId: batch.id, status: batch.status, createdAt: new Date().toISOString(), items: [], missing: [] };
    for (const item of batch.items) {
      const job = this.store.jobs.findById(item.jobId), version = item.resumeVersionId ? this.store.resumeVersions.findById(item.resumeVersionId) : null, suffix = createHash("sha256").update(item.id).digest("hex").slice(0, 12), folder = `${safeSegment(job?.company, "empresa")}/${safeSegment(job?.title, item.jobId)}-${suffix}`, entry = { batchItemId: item.id, jobId: item.jobId, resumeId: item.finalResumeId || item.selectedBaseResumeId, resumeVersionId: item.resumeVersionId, status: item.status, files: [] };
      if (version && version.jobId === item.jobId && ["APPROVED", "READY"].includes(version.status)) for (const artifact of ["PDF", "LATEX_SOURCE", "EXTRACTED_TEXT", "EXPORT_BUNDLE"].map(type => this.store.resumeArtifacts.latest(version.id, type)).filter(Boolean)) {
        const requested = artifact.artifactType === "PDF" ? batch.requestedOutputs.pdf : ["LATEX_SOURCE", "EXTRACTED_TEXT"].includes(artifact.artifactType) ? batch.requestedOutputs.latex : artifact.artifactType === "EXPORT_BUNDLE" ? batch.requestedOutputs.overleaf : false;
        if (!requested || artifact.status !== "READY") continue;
        try {
          const data = await this.store.resumeArtifactService.readAllowed(artifact, version.resumeId), name = `${folder}/${({ PDF: "resume.pdf", LATEX_SOURCE: "resume.tex", EXTRACTED_TEXT: "extracted.txt", EXPORT_BUNDLE: "overleaf-export.zip" })[artifact.artifactType]}`;
          files.push({ name, data }); entry.files.push({ name, artifactId: artifact.id, type: artifact.artifactType, sha256: createHash("sha256").update(data).digest("hex"), sizeBytes: data.length });
        } catch (error) { manifest.missing.push({ batchItemId: item.id, artifactId: artifact.id, code: error.code || "ARTIFACT_UNAVAILABLE" }); }
      }
      for (const [output, type] of Object.entries({pdf:"PDF",latex:"LATEX_SOURCE",overleaf:"EXPORT_BUNDLE"})) if (batch.requestedOutputs[output] && !entry.files.some(file => file.type === type)) manifest.missing.push({batchItemId:item.id, output, code:"REQUESTED_OUTPUT_NOT_READY"});
      manifest.items.push(entry);
    }
    files.push({ name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n` });
    return { data: zipStored(files), manifest, fileName: `resume-batch-${safeSegment(batch.id, "export")}.zip` };
  }
}
