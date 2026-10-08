const entities = Object.freeze({
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  ndash: "-", mdash: "-", bull: "-", hellip: "...",
});

function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
    if (token[0] !== "#") return entities[token.toLowerCase()] ?? entity;
    const numeric = token[1].toLowerCase() === "x"
      ? Number.parseInt(token.slice(2), 16)
      : Number.parseInt(token.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

export function normalizeJobDescription(value) {
  const raw = String(value || "");
  if (!raw.trim()) return "";
  const structured = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n")
    .replace(/<\/h[1-6]\s*>/gi, ":\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<\/?(?:p|ul|ol|div|section|article|table|thead|tbody|tr|td|th|blockquote)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(structured)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .map((line) => line.replace(/:{2,}$/, ":"))
    .join("\n");
}
