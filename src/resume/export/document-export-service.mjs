import { createHash } from "node:crypto";
import { DestinationRegistry } from "./destination-registry.mjs";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (data) => {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export function zipStored(files) {
  const locals = [],
    centrals = [];
  let offset = 0;
  const seen=new Set();
  for (const file of files) {
    const entry=String(file.name).replaceAll("\\", "/");
    if(!entry||entry.startsWith("/")||entry.split("/").some(part=>!part||part==="."||part==="..")||/[:\x00-\x1f]/.test(entry)||seen.has(entry.toLowerCase()))
      throw Object.assign(new Error("Unsafe or duplicate ZIP entry"),{code:"ZIP_ENTRY_INVALID"});
    seen.add(entry.toLowerCase());
    const name = Buffer.from(file.name.replaceAll("\\", "/"), "utf8"),
      data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data),
      crc = crc32(data),
      local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, x) => sum + x.length, 0),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export class DocumentExportService {
  constructor({
    versions,
    artifacts,
    exports,
    artifactService,
    eventBus = null,
    registry = new DestinationRegistry(),
    policy = {},
  } = {}) {
    Object.assign(this, {
      versions,
      artifacts,
      exports,
      artifactService,
      eventBus,
      registry,
    });
    this.policy = {
      allowExternalExport: false,
      allowN8nDocumentEvents: false,
      ...policy,
    };
  }
  async export(versionId, destinationId) {
    const version = this.versions.findById(versionId);
    if (!version)
      throw Object.assign(new Error("Versao nao encontrada."), {
        code: "RESUME_VERSION_NOT_FOUND",
      });
    if (!["APPROVED", "READY"].includes(version.status))
      throw Object.assign(
        new Error("Somente versao aprovada pode ser exportada."),
        { code: "RESUME_VERSION_NOT_APPROVED" },
      );
    const destination = this.registry.get(destinationId);
    if (destination.id === "LOCAL") {
      const artifact =
        this.artifacts.latest(versionId, "PDF") ||
        this.artifacts.latest(versionId, "LATEX_SOURCE");
      if (!artifact)
        throw Object.assign(new Error("Nenhum artefato local disponivel."), {
          code: "RESUME_ARTIFACT_MISSING",
        });
      const record = this.exports.create({
        resumeVersionId: versionId,
        destination: "LOCAL",
        status: "COMPLETED",
        artifactId: artifact.id,
        destinationReference: artifact.storagePath,
        metadata: { artifactType: artifact.artifactType },
      });
      this.eventBus?.emit("RESUME_EXPORTED", {
        resumeVersionId: versionId,
        destination: "LOCAL",
        artifactId: artifact.id,
        exportId: record.id,
      });
      return record;
    }
    if (destination.id === "N8N") {
      const status = this.policy.allowN8nDocumentEvents
          ? "COMPLETED"
          : "NOT_CONFIGURED",
        record = this.exports.create({
          resumeVersionId: versionId,
          destination: "N8N",
          status,
          errorCode:
            status === "COMPLETED" ? "" : "N8N_DOCUMENT_EVENTS_DISABLED",
          metadata: {},
        });
      if (status === "COMPLETED")
        this.eventBus?.emit("RESUME_EXPORTED", {
          resumeVersionId: versionId,
          destination: "N8N",
          exportId: record.id,
        });
      return record;
    }
    if (destination.id === "OVERLEAF") {
      const latex = this.artifacts.latest(versionId, "LATEX_SOURCE");
      if (!latex)
        throw Object.assign(new Error("Fonte LaTeX nao disponivel."), {
          code: "LATEX_ARTIFACT_MISSING",
        });
      const previous = this.exports.forVersion(versionId).find(item => item.destination === "OVERLEAF" && item.status === "OVERLEAF_EXPORT_READY" && item.metadata?.files?.[0]?.sha256 === latex.contentHash);
      if (previous && this.artifacts.forVersion(versionId).some(item => item.id === previous.artifactId && item.status === "READY")) return { ...previous, reused: true };
      const source = await this.artifactService.readAllowed(
          latex,
          version.resumeId,
        ),
        manifest = {
          schemaVersion: "overleaf-export-v1",
          resumeVersionId: version.id,
          template: {
            id: version.templateId,
            version: version.templateVersion,
          },
          language: version.language,
          files: [
            {
              name: "resume.tex",
              sha256: createHash("sha256").update(source).digest("hex"),
            },
          ],
          createdAt: new Date().toISOString(),
          mode: "EXPORT_ONLY",
        },
        bundle = zipStored([
          { name: "resume.tex", data: source },
          {
            name: "manifest.json",
            data: `${JSON.stringify(manifest, null, 2)}\n`,
          },
        ]),
        artifact = await this.artifactService.write({
          resumeId: version.resumeId,
          resumeVersionId: version.id,
          artifactType: "EXPORT_BUNDLE",
          content: bundle,
          validation: { destination: "OVERLEAF", manifest },
        }),
        record = this.exports.create({
          resumeVersionId: versionId,
          destination: "OVERLEAF",
          status: "OVERLEAF_EXPORT_READY",
          artifactId: artifact.id,
          destinationReference: artifact.storagePath,
          metadata: { mode: "EXPORT_ONLY", files: manifest.files },
        });
      this.eventBus?.emit("RESUME_EXPORTED", {
        resumeVersionId: versionId,
        destination: "OVERLEAF",
        artifactId: artifact.id,
        exportId: record.id,
      });
      return record;
    }
    return this.exports.create({
      resumeVersionId: versionId,
      destination: destination.id,
      status: "NOT_CONFIGURED",
      errorCode: "DESTINATION_NOT_IMPLEMENTED",
      metadata: { mode: destination.mode },
    });
  }
}
