import path from "node:path";
import { AppError } from "./errors.mjs";

export const MAX_RESUME_FILE_SIZE = 12 * 1024 * 1024;

const allowedResumeTypes = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".txt", new Set(["text/plain", "application/octet-stream"])]
]);

export function decodeResumeUpload(fileName, fileData) {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const allowedMimeTypes = allowedResumeTypes.get(extension);
  if (!allowedMimeTypes) {
    throw new AppError("Arquivo nao permitido. Use PDF, DOCX ou TXT.", {
      status: 400,
      code: "FILE_TYPE_NOT_ALLOWED"
    });
  }

  const match = String(fileData || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match || !allowedMimeTypes.has(match[1].toLowerCase())) {
    throw new AppError("Arquivo invalido ou tipo de arquivo divergente.", {
      status: 400,
      code: "INVALID_FILE"
    });
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > MAX_RESUME_FILE_SIZE) {
    throw new AppError("O arquivo deve ter no maximo 12 MB.", {
      status: 413,
      code: "FILE_TOO_LARGE"
    });
  }
  return buffer;
}
