import path from "node:path";
import { RawSqliteReader } from "./lib/sqlite-forensics.mjs";

const source = process.argv[2];
if (!source) throw new Error("Uso: node scripts/sqlite-forensics-inspect.mjs <sqlite>");

const reader = await RawSqliteReader.open(path.resolve(source));
const schema = reader.readSchema();
const tables = schema.entries.filter((entry) => entry.type === "table");
const report = {
  source: path.resolve(source),
  pageSize: reader.pageSize,
  physicalPageCount: reader.physicalPageCount,
  declaredPageCount: reader.declaredPageCount,
  schemaRows: schema.rows.length,
  schemaErrors: schema.errors,
  tables: tables.map(({ name, rootPage }) => ({ name, rootPage }))
};
console.log(JSON.stringify(report, null, 2));
