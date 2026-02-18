(() => {
  const BASE = "/SolarOS";
  const SUPPORTED = ["en", "pt"];
  const DEFAULT_LANG = "en";

  function normalizeLang(raw) {
    const v = (raw || "").toLowerCase();
    if (v.startsWith("pt")) return "pt";
    return "en";
  }

  async function loadLang(lang) {
    const safe = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    const url = `${BASE}/lang/${safe}.json?v=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("lang_fetch_failed");
    const dict = await res.json();
    return { lang: safe, dict };
  }

  function applyTranslations(dict, lang) {
    document.documentElement.lang = lang;

    if (dict.page_title) document.title = dict.page_title;
    const homeTitle = document.querySelector("[data-i18n-title='nav_home_title']");
    if (homeTitle && dict.nav_home_title) homeTitle.setAttribute("title", dict.nav_home_title);

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = dict[key];
      if (typeof val === "string") el.textContent = val;
    });

    document.querySelectorAll("button.link[data-lang]").forEach((btn) => {
      const isActive = btn.getAttribute("data-lang") === lang;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  async function setLang(lang) {
    const normalized = normalizeLang(lang);
    const { lang: safeLang, dict } = await loadLang(normalized);
    localStorage.setItem("lang", safeLang);
    applyTranslations(dict, safeLang);
  }

  window.addEventListener("DOMContentLoaded", async () => {
    const saved = localStorage.getItem("lang");
    const browser = normalizeLang((navigator.languages && navigator.languages[0]) || navigator.language);
    const initial = saved || browser || DEFAULT_LANG;

    try {
      await setLang(initial);
    } catch {
      // fallback silencioso
      const { lang, dict } = await loadLang(DEFAULT_LANG);
      applyTranslations(dict, lang);
    }

    document.querySelectorAll("button.link[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => setLang(btn.getAttribute("data-lang")));
    });
  });
})();
