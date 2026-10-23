export function canTryPublicAlternative(error) {
  return /^HTTP_5\d\d$/.test(error?.code || "") || ["ENGINE_TIMEOUT", "FETCH_FAILED", "ECONNRESET", "ECONNREFUSED"].includes(error?.code || error?.cause?.code) || ["TimeoutError", "AbortError"].includes(error?.name) || (error?.name === "TypeError" && error.message === "fetch failed");
}

export async function publicAlternative(error, { primary, alternate, work }) {
  if (!canTryPublicAlternative(error)) throw error;
  const attempts = [{ strategy: primary, status: "FAILED", errorCode: error.code || "ENGINE_TIMEOUT" }];
  try {
    const result = await work();
    return { ...result, strategy: alternate, strategyAttempts: [...attempts, { strategy: alternate, status: "SUCCESS" }] };
  } catch (cause) {
    throw Object.assign(new Error("As formas públicas de consulta desta fonte falharam.", { cause }), {
      code: cause.code || error.code || "PUBLIC_ALTERNATIVE_FAILED",
      status: cause.status || error.status,
      alternativesExhausted: true,
      strategyAttempts: [...attempts, { strategy: alternate, status: "FAILED", errorCode: cause.code || "PUBLIC_ALTERNATIVE_FAILED" }],
    });
  }
}

// Parse serialized public data only. Never execute the portal's scripts.
export function solidesPublicHtmlJobs(html) {
  const parts = [...String(html).matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)].flatMap(match => {
    try { const part = JSON.parse(match[1]); return part[0] === 1 && typeof part[1] === "string" ? [part[1]] : []; }
    catch { return []; }
  });
  const stream = parts.join("");
  const jobs = new Map();
  let visited = 0;
  const walk = value => {
    if (!value || typeof value !== "object" || ++visited > 20000) return;
    if (value.id && value.title && value.companyName) {
      let description = value.description || "";
      if (/^\$[0-9a-f]+$/i.test(description)) {
        const marker = `${description.slice(1)}:T`, at = stream.indexOf(marker);
        const length = at >= 0 ? stream.slice(at + marker.length).match(/^([0-9a-f]+),/i) : null;
        if (length) {
          const start = at + marker.length + length[0].length;
          description = Buffer.from(stream.slice(start), "utf8").subarray(0, parseInt(length[1], 16)).toString("utf8");
        } else description = "";
      }
      jobs.set(String(value.id), { ...value, description });
    }
    for (const child of Object.values(value)) walk(child);
  };
  for (const line of parts.flatMap(part => part.split("\n"))) {
    if (!/^[0-9a-f]+:[\[{]/i.test(line)) continue;
    try { walk(JSON.parse(line.slice(line.indexOf(":") + 1))); } catch { /* Non-JSON flight records are not job data. */ }
  }
  if (!jobs.size) throw Object.assign(new Error("Página pública Sólides sem catálogo estruturado reconhecido."), { code: "SOLIDES_PUBLIC_HTML_INVALID" });
  return [...jobs.values()];
}
