const clean = (value) => String(value || "")
  .trim()
  .normalize("NFD")
  .replace(/\p{Diacritic}/gu, "")
  .toLowerCase();

const surface = (id, label, location, workModel, remoteScope, country, transportLocation) => Object.freeze({
  id,
  label,
  location,
  workModel,
  remoteScope,
  country,
  transportLocation,
});

export const GEOGRAPHY_SURFACES = Object.freeze({
  LOCAL_DF: surface("LOCAL_DF", "Brasília / DF", "Brasília, DF", "ANY", "", "Brazil", "Brasília, Federal District, Brazil"),
  REMOTE_BRAZIL: surface("REMOTE_BRAZIL", "Remoto no Brasil", "Brasil", "REMOTE", "Brasil", "Brazil", "Brazil"),
  LOCAL_LISBON: surface("LOCAL_LISBON", "Lisboa", "Lisboa, Portugal", "ANY", "", "Portugal", "Lisbon, Portugal"),
  LOCAL_PORTO: surface("LOCAL_PORTO", "Porto", "Porto, Portugal", "ANY", "", "Portugal", "Porto, Portugal"),
  LOCAL_BRAGA: surface("LOCAL_BRAGA", "Braga", "Braga, Portugal", "ANY", "", "Portugal", "Braga, Portugal"),
  REMOTE_PORTUGAL: surface("REMOTE_PORTUGAL", "Remoto em Portugal", "Portugal", "REMOTE", "Portugal", "Portugal", "Portugal"),
});

const countryFor = (value) => {
  const normalized = clean(value);
  if (/\b(portugal|portuguesa?)\b/.test(normalized) || /\b(lisboa|lisbon|porto|braga|coimbra|aveiro|faro|setubal|leiria)\b/.test(normalized)) return "Portugal";
  if (/\b(brasil|brazil)\b/.test(normalized) || /\b(brasilia|distrito federal)\b/.test(normalized) || normalized === "df") return "Brazil";
  return "";
};

const slug = (value) => clean(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase().slice(0, 48) || "CUSTOM";

function configuredSurface(item, index) {
  const location = String(item.location || "").trim();
  const remoteScope = String(item.remoteScope || "").trim();
  const workModel = String(item.workModel || "ONSITE").toUpperCase();
  const country = countryFor(`${remoteScope} ${location}`);
  if (workModel === "REMOTE") {
    return {
      id: `REMOTE_${country === "Portugal" ? "PORTUGAL" : country === "Brazil" ? "BRAZIL" : slug(remoteScope || location)}`,
      label: `Remoto${remoteScope || location ? ` - ${remoteScope || location}` : ""}`,
      location: location || remoteScope,
      workModel,
      remoteScope: remoteScope || location,
      country,
      transportLocation: country || location || remoteScope,
      priority: Number(item.priority) || index + 1,
    };
  }
  return {
    id: `LOCAL_${slug(location)}`,
    label: location || "Localizacao configurada",
    location,
    workModel,
    remoteScope: "",
    country,
    transportLocation: location,
    priority: Number(item.priority) || index + 1,
  };
}

function knownSurface(item) {
  const location = clean(item.location);
  const scope = clean(item.remoteScope);
  const model = String(item.workModel || "").toUpperCase();
  if (model === "REMOTE" && (scope.includes("portugal") || location === "portugal")) return GEOGRAPHY_SURFACES.REMOTE_PORTUGAL;
  if (model === "REMOTE" && (scope.includes("brasil") || location.includes("brasil"))) return GEOGRAPHY_SURFACES.REMOTE_BRAZIL;
  if (/\b(lisboa|lisbon)\b/.test(location)) return GEOGRAPHY_SURFACES.LOCAL_LISBON;
  if (/\bporto\b/.test(location)) return GEOGRAPHY_SURFACES.LOCAL_PORTO;
  if (/\bbraga\b/.test(location)) return GEOGRAPHY_SURFACES.LOCAL_BRAGA;
  if (location.includes("brasilia") || location === "df" || location.includes("distrito federal")) return GEOGRAPHY_SURFACES.LOCAL_DF;
  return null;
}

export function geographySurfaceById(id) {
  return GEOGRAPHY_SURFACES[String(id || "").toUpperCase()] || null;
}

export function resolveGeographySurfaces(locationPolicy = {}) {
  const priorities = Array.isArray(locationPolicy.priorities) ? locationPolicy.priorities : [];
  if (!priorities.length) return [GEOGRAPHY_SURFACES.REMOTE_PORTUGAL];
  const selected = priorities
    .filter((item) => item.accepted !== false && (item.location || item.remoteScope))
    .map((item, index) => knownSurface(item) || configuredSurface(item, index));
  return [...new Map(selected.map((item) => [item.id, item])).values()];
}
