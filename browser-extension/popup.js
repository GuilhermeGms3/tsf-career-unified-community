const statusEl = document.querySelector("#status");
const fillButton = document.querySelector("#fill");
const overwriteEl = document.querySelector("#overwrite");
let profile = null;

async function loadProfile() {
  for (const baseUrl of ["http://localhost:7123", "http://127.0.0.1:7123"]) {
    try {
      const response = await fetch(`${baseUrl}/api/profile`);
      if (!response.ok) continue;
      profile = await response.json();
      statusEl.textContent = profile.personal?.fullName
        ? `Perfil carregado: ${profile.personal.fullName}`
        : "Perfil encontrado, mas o nome ainda nao foi preenchido.";
      fillButton.disabled = false;
      return;
    } catch {
      // Try the next local address.
    }
  }
  statusEl.textContent = "Abra o Career Hub em localhost:7123 antes de preencher.";
}

function fillApplicationForm(profileData, overwrite) {
  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const personal = profileData.personal || {};
  const career = profileData.career || {};
  const fullName = personal.fullName || "";
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ");
  const locationParts = String(personal.city || "").split(",").map((item) => item.trim());
  const values = [
    { patterns: ["first name", "primeiro nome", "nome"], value: firstName, strict: ["first", "primeiro"] },
    { patterns: ["last name", "sobrenome"], value: lastName },
    { patterns: ["full name", "nome completo", "candidate name"], value: fullName },
    { patterns: ["email", "e-mail"], value: personal.email },
    { patterns: ["phone", "telefone", "celular", "mobile"], value: personal.phone },
    { patterns: ["linkedin"], value: personal.linkedin },
    { patterns: ["github"], value: personal.github },
    { patterns: ["portfolio", "website", "site pessoal"], value: personal.portfolio },
    { patterns: ["postal", "zip code", "cep"], value: personal.postalCode },
    { patterns: ["state", "estado", "uf"], value: personal.state || locationParts[1] },
    { patterns: ["city", "cidade"], value: locationParts[0] },
    { patterns: ["country", "pais"], value: personal.country },
    { patterns: ["salary", "salario", "pretensao"], value: career.salaryExpectation },
    { patterns: ["professional summary", "resumo profissional", "about you", "sobre voce"], value: career.summary },
    { patterns: ["experience", "experiencia profissional"], value: profileData.experience },
    { patterns: ["education", "formacao", "escolaridade"], value: profileData.education }
  ];

  function contextFor(element) {
    const label = element.labels?.[0]?.innerText || element.closest("label")?.innerText || "";
    return normalize([
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("aria-label"),
      label
    ].filter(Boolean).join(" "));
  }

  function setValue(element, value) {
    if (!value || (!overwrite && String(element.value || "").trim())) return false;
    if (element.tagName === "SELECT") {
      const wanted = normalize(value);
      const option = [...element.options].find((item) =>
        normalize(`${item.value} ${item.textContent}`).includes(wanted) ||
        wanted.includes(normalize(item.textContent))
      );
      if (!option) return false;
      element.value = option.value;
    } else {
      const prototype = element.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, String(value));
      else element.value = String(value);
    }
    for (const eventName of ["input", "change", "blur"]) {
      element.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
    element.style.outline = "2px solid #176b63";
    element.style.outlineOffset = "2px";
    return true;
  }

  let filled = 0;
  const fields = [...document.querySelectorAll("input, textarea, select")].filter((element) => {
    const type = normalize(element.type);
    return !element.disabled && !element.readOnly &&
      !["hidden", "password", "file", "submit", "button", "checkbox", "radio"].includes(type);
  });
  for (const field of fields) {
    const context = contextFor(field);
    const match = values.find((candidate) => {
      if (!candidate.value) return false;
      if (candidate.strict) return candidate.strict.some((pattern) => context.includes(pattern));
      return candidate.patterns.some((pattern) => context.includes(normalize(pattern)));
    });
    if (match && setValue(field, match.value)) filled += 1;
  }
  return filled;
}

fillButton.addEventListener("click", async () => {
  fillButton.disabled = true;
  statusEl.textContent = "Preenchendo campos reconhecidos...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: fillApplicationForm,
      args: [profile, overwriteEl.checked]
    });
    const count = Number(result?.result || 0);
    statusEl.textContent = `${count} campo(s) preenchido(s). Revise antes de continuar.`;
  } catch (error) {
    statusEl.textContent = `Nao foi possivel preencher: ${error.message}`;
  } finally {
    fillButton.disabled = false;
  }
});

loadProfile();
