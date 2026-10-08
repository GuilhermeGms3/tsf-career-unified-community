import { AppError, errorPayload } from "./errors.mjs";

export const DEFAULT_JSON_LIMIT = 2 * 1024 * 1024;
export const BASE64_UPLOAD_LIMIT = 18 * 1024 * 1024;
export const BACKUP_UPLOAD_LIMIT = 64 * 1024 * 1024;

export async function readJsonBody(req, { limit = DEFAULT_JSON_LIMIT } = {}) {
  return (await readRawJsonBody(req,{limit})).data;
}

export async function readRawJsonBody(req,{limit=DEFAULT_JSON_LIMIT}={}){
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new AppError(`O corpo da requisicao excede o limite de ${formatMegabytes(limit)}.`, {
        status: 413,
        code: "PAYLOAD_TOO_LARGE"
      });
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  try {
    return {data:JSON.parse(body || "{}"),raw:body||"{}"};
  } catch (error) {
    throw new AppError("O corpo da requisicao contem JSON invalido.", {
      status: 400,
      code: "INVALID_JSON",
      cause: error
    });
  }
}

export function sendJson(res, data, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function sendError(res, error, fallback) {
  const { status, body } = errorPayload(error, fallback);
  sendJson(res, body, status);
}

function formatMegabytes(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
