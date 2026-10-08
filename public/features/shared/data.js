import { api } from "../../api/client.js";
export { api };
export async function allSettledMap(requests) {
  const entries = Object.entries(requests),
    values = await Promise.allSettled(entries.map(([, request]) => request));
  return Object.fromEntries(
    values.map((result, index) => [
      entries[index][0],
      result.status === "fulfilled"
        ? { ok: true, value: result.value }
        : { ok: false, error: result.reason },
    ]),
  );
}
