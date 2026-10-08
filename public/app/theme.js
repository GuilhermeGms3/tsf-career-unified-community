import { icon } from "./icons.js";

const currentTheme = () =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

function updateButtons() {
  const dark = currentTheme() === "dark";
  const label = dark ? "Usar tema claro" : "Usar tema escuro";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#0a0f0d" : "#111815");
  for (const button of document.querySelectorAll("[data-theme-toggle]")) {
    button.innerHTML = `${icon(dark ? "sun" : "moon")}<span>${label}</span>`;
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }
}

export function initTheme() {
  updateButtons();
  for (const button of document.querySelectorAll("[data-theme-toggle]"))
    button.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem("career-theme", next);
      } catch {}
      updateButtons();
    });
}
