(() => {
  try {
    const saved = localStorage.getItem("career-theme");
    const theme = ["light", "dark"].includes(saved)
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = theme;
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
