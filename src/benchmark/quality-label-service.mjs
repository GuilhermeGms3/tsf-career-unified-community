import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const parseJsonLines = (body) => String(body || "").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const asNullableBoolean = (value) => value === true ? true : value === false ? false : null;
const asNullableText = (value, max = 500) => value == null || String(value).trim() === "" ? null : String(value).trim().slice(0, max);
const asList = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].slice(0, 100) : null;
const official = (record) => ["DISCOVERY", "PROVIDER", "MANUAL_IMPORT"].includes(record?.provenance?.originType);

export class QualityLabelService {
  constructor({ dataDir } = {}) {
    this.jobsPath = path.join(dataDir, "benchmarks", "jobs", "jobs.jsonl");
    this.labelsPath = path.join(dataDir, "benchmarks", "labels", "gold-labels.jsonl");
    this.writeQueue = Promise.resolve();
  }

  async read(file) {
    try { return parseJsonLines(await readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  async list() {
    const [allRecords, labels] = await Promise.all([this.read(this.jobsPath), this.read(this.labelsPath)]);
    const records = allRecords.filter(official), labelsByJob = new Map(labels.map((label) => [label.jobId, label]));
    const items = records.map((record) => ({ record, label: labelsByJob.get(record.benchmarkJobId) || null }));
    return {
      items,
      summary: {
        jobs: records.length,
        labeled: items.filter((item) => item.label?.labeledAt).length,
        awaitingLabels: items.filter((item) => !item.label?.labeledAt).length,
      },
    };
  }

  async save(jobId, input = {}) {
    const decision = String(input.applicationDecision || "").toUpperCase();
    if (!["APPLY", "MAYBE", "DO_NOT_APPLY"].includes(decision)) throw Object.assign(new Error("Informe se aplicaria, talvez aplicaria ou não aplicaria."), { code: "QUALITY_LABEL_DECISION_REQUIRED" });
    const { items } = await this.list();
    if (!items.some((item) => item.record.benchmarkJobId === jobId)) throw Object.assign(new Error("Vaga do benchmark não encontrada."), { code: "QUALITY_LABEL_JOB_NOT_FOUND", status: 404 });
    const label = {
      jobId,
      relevant: asNullableBoolean(input.relevant),
      jobFamily: asNullableText(input.jobFamily, 120),
      seniority: asNullableText(input.seniority, 80),
      seniorityCorrect: asNullableBoolean(input.seniorityCorrect),
      locationAcceptable: asNullableBoolean(input.locationAcceptable),
      openAtLabelTime: asNullableBoolean(input.openAtLabelTime),
      requiredSkills: asList(input.requiredSkills),
      preferredSkills: asList(input.preferredSkills),
      hardRequirements: asList(input.hardRequirements),
      blockingRequirements: asList(input.blockingRequirements),
      applicationDecision: decision,
      humanWouldApply: decision === "APPLY" ? true : decision === "DO_NOT_APPLY" ? false : null,
      humanPriority: Number.isFinite(Number(input.humanPriority)) ? Math.max(0, Math.min(100, Math.round(Number(input.humanPriority)))) : null,
      notes: asNullableText(input.notes, 1000),
      labeledAt: new Date().toISOString(),
      labelVersion: 1,
    };
    this.writeQueue = this.writeQueue.then(async () => {
      const labels = await this.read(this.labelsPath), byJob = new Map(labels.map((item) => [item.jobId, item]));
      byJob.set(jobId, label);
      await mkdir(path.dirname(this.labelsPath), { recursive: true });
      const temporary = `${this.labelsPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${[...byJob.values()].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
      await rename(temporary, this.labelsPath);
    });
    await this.writeQueue;
    return label;
  }
}
