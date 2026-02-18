(() => {
  "use strict";

  const BASE = "/SolarOS";
  const SUPPORTED = ["en", "pt"];
  const DEFAULT_LANG = "pt"; // mude pra "en" se quiser
  const VERSION = (window.SOLAROS_LANG_VERSION ?? "2");

  const STORAGE_KEY = "lang";
  const WARN_ONCE_KEY = "solaros_i18n_json_warned";

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

  function warnInvalidJsonOnce(url, err) {
    try {
      if (sessionStorage.getItem(WARN_ONCE_KEY) === "1") return;
      sessionStorage.setItem(WARN_ONCE_KEY, "1");
    } catch {}

    const msg =
      `SolarOS i18n: JSON inválido em\n${url}\n\n` +
      `Detalhes:\n${String(err && err.message ? err.message : err)}`;

    try { console.error(msg); } catch {}
    try { alert(msg); } catch {}
  }

  async function fetchJsonStrict(url) {
    const res = await fetch(url, { credentials: "same-origin" });

    if (!res.ok) {
      const e = new Error("http_error");
      e.status = res.status;
      e.url = url;
      throw e;
    }

    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      e.url = url;
      e.raw = text;
      throw e;
    }
  }

  async function loadLang(lang) {
    const safe = SUPPORTED.includes(lang) ? lang : DEFAULT_LANG;
    const url = langUrl(safe);

    try {
      const dict = await fetchJsonStrict(url);
      return { lang: safe, dict };
    } catch (e) {
      if (e && e.name === "SyntaxError") warnInvalidJsonOnce(url, e);
      throw e;
    }
  }

  function getPageTitleKey(dict) {
    // 1) <html data-i18n-page-title="page_title_about">
    const htmlKey = document.documentElement.getAttribute("data-i18n-page-title");
    if (htmlKey && typeof dict?.[htmlKey] === "string") return htmlKey;

    // 2) <meta name="i18n-page-title" content="page_title_about">
    const meta = document.querySelector('meta[name="i18n-page-title"][content]');
    const metaKey = meta ? meta.getAttribute("content") : null;
    if (metaKey && typeof dict?.[metaKey] === "string") return metaKey;

    // 3) padrão
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

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      const val = dict?.[key];
      if (typeof val === "string") el.textContent = val;
    });

    // toggles opcionais (se você usar)
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
    return safeLang;
  }

  function wireLangButtons() {
    // funciona mesmo se os botões forem inseridos depois
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

    // fallback silencioso (só avisa se o JSON do fallback estiver inválido)
    if (initial !== DEFAULT_LANG) {
      try {
        await setLang(DEFAULT_LANG, { persist: false });
      } catch {}
    }
  });
})();
