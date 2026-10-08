import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.mjs";

export async function atomicWriteJson(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  );

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw new AppError("Falha ao salvar o arquivo JSON.", {
      status: error?.code === "EACCES" || error?.code === "EPERM" ? 403 : 500,
      code: error?.code === "EACCES" || error?.code === "EPERM" ? "PERMISSION_DENIED" : "JSON_SAVE_FAILED",
      cause: error
    });
  }
}
