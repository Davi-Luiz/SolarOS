(() => {
  "use strict";

  const BASE = "/SolarOS";
  const SUPPORTED = ["en", "pt"];
  const DEFAULT_LANG = "pt";
  const VERSION = window.SOLAROS_LANG_VERSION ?? "3";
  const STORAGE_KEY = "lang";
  const SOLARAI_LANG_KEY = "solarai_language";

  function normalizeLang(raw) {
    const v = String(raw || "").trim().toLowerCase();
    if (v.startsWith("pt")) return "pt";
    if (v.startsWith("en")) return "en";
    return DEFAULT_LANG;
  }

  function getUrlLang() {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("lang");
      if (!q) return null;
      const n = normalizeLang(q);
      return SUPPORTED.includes(n) ? n : null;
    } catch {
      return null;
    }
  }

  function pickBrowserLang() {
    const list = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language, navigator.userLanguage].filter(Boolean);

    for (const item of list) {
      const n = normalizeLang(item);
      if (SUPPORTED.includes(n)) return n;
    }
    return DEFAULT_LANG;
  }

  function getSavedLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {}
    return null;
  }

  function getInitialLang() {
    return getUrlLang() || getSavedLang() || pickBrowserLang() || DEFAULT_LANG;
  }

  function langUrl(lang) {
    const safe = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    return `${BASE}/lang/${safe}.json?v=${encodeURIComponent(String(VERSION))}`;
  }

  async function fetchJsonStrict(url) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      const e = new Error("http_error");
      e.status = res.status;
      e.url = url;
      throw e;
    }
    return JSON.parse(await res.text());
  }

  async function loadLang(lang) {
    const safe = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    const url = langUrl(safe);
    const dict = await fetchJsonStrict(url);
    return { lang: safe, dict };
  }

  function getPageTitleKey(dict) {
    const htmlKey = document.documentElement.getAttribute("data-i18n-page-title");
    if (htmlKey && typeof dict?.[htmlKey] === "string") return htmlKey;

    const metaPageTitle = document.querySelector('meta[name="i18n-page-title"][content]');
    const metaLegacy = document.querySelector('meta[name="i18n-title"][content]');
    const metaKey = metaPageTitle?.getAttribute("content") || metaLegacy?.getAttribute("content") || null;
    if (metaKey && typeof dict?.[metaKey] === "string") return metaKey;

    if (typeof dict?.page_title === "string") return "page_title";
    return null;
  }

  function applyTranslations(dict, lang) {
    document.documentElement.lang = lang;

    const titleKey = getPageTitleKey(dict);
    if (titleKey) document.title = dict[titleKey];

    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      const val = dict?.[key];
      if (typeof val === "string") el.setAttribute("title", val);
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      const val = dict?.[key];
      if (typeof val === "string") el.setAttribute("aria-label", val);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      const val = dict?.[key];
      if (typeof val === "string") el.setAttribute("placeholder", val);
    });

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = dict?.[key];
      if (typeof val === "string") el.textContent = val;
    });

    document.querySelectorAll("[data-i18n-set-lang][data-lang], button.link[data-lang]").forEach((btn) => {
      const bLang = normalizeLang(btn.getAttribute("data-lang"));
      const isActive = bLang === lang;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  async function setLang(lang, { persist = true } = {}) {
    const normalized = normalizeLang(lang);
    const { lang: safeLang, dict } = await loadLang(normalized);

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, safeLang); } catch {}
    }

    applyTranslations(dict, safeLang);
    try { localStorage.setItem(SOLARAI_LANG_KEY, safeLang); } catch {}
    document.dispatchEvent(new CustomEvent("i18n:updated", { detail: { lang: safeLang, dict } }));
    return safeLang;
  }

  function wireLangButtons() {
    document.addEventListener(
      "click",
      (ev) => {
        const t = ev.target?.closest?.("[data-i18n-set-lang][data-lang], button.link[data-lang]");
        if (!t) return;

        ev.preventDefault();
        const lang = t.getAttribute("data-lang");
        setLang(lang).catch(() => {});
      },
      { passive: false }
    );
  }

  window.addEventListener("DOMContentLoaded", async () => {
    wireLangButtons();

    const initial = getInitialLang();

    try {
      await setLang(initial, { persist: true });
      return;
    } catch {}

    if (initial !== DEFAULT_LANG) {
      try {
        await setLang(DEFAULT_LANG, { persist: false });
      } catch {}
    }
  });
})();
