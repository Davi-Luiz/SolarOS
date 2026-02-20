(() => {
  "use strict";

  const BASE = "/SolarOS";
  const SUPPORTED = ["en", "pt"];
  const DEFAULT_LANG = "pt";
  const VERSION = window.SOLAROS_LANG_VERSION ?? "3";

  const STORAGE_KEY = "lang";
  const WARN_ONCE_KEY = "solaros_i18n_json_warned";

  // Diagnóstico de i18n: ajuda a achar tradução inútil/repetida.
  const I18N_AUDIT = {
    enabled: true,
    warnUnusedKeys: true,
    warnMissingKeys: true,
    warnDuplicateKeys: true,
    warnRepeatedValues: true,
    repeatedValueMinLength: 6,
    maxListPreview: 20,
  };

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

  function listPreview(arr, max = 20) {
    if (!Array.isArray(arr) || arr.length === 0) return "(vazio)";
    const shown = arr.slice(0, max);
    const suffix = arr.length > max ? ` ... (+${arr.length - max})` : "";
    return shown.join(", ") + suffix;
  }

  function collectDomI18nKeys(dict) {
    const used = new Set();

    const titleKey = getPageTitleKey(dict);
    if (titleKey) used.add(titleKey);

    const htmlKey = document.documentElement.getAttribute("data-i18n-page-title");
    if (htmlKey) used.add(htmlKey);

    const meta = document.querySelector('meta[name="i18n-page-title"][content]');
    const metaKey = meta ? meta.getAttribute("content") : null;
    if (metaKey) used.add(metaKey);

    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) used.add(key);
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) used.add(key);
    });

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) used.add(key);
    });

    return used;
  }

  // Scanner simples para detectar chaves repetidas no JSON raw.
  // Funciona muito bem para arquivos de i18n flat (objeto único de chaves string).
  function scanDuplicateJsonKeys(rawText) {
    const lines = String(rawText || "").split(/\r?\n/);
    const counts = new Map();
    const lineMap = new Map();

    const keyRegex = /^\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const m = line.match(keyRegex);
      if (!m) continue;
      const key = m[1];
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!lineMap.has(key)) lineMap.set(key, []);
      lineMap.get(key).push(i + 1);
    }

    const duplicates = [];
    for (const [key, count] of counts.entries()) {
      if (count > 1) {
        duplicates.push({ key, count, lines: lineMap.get(key) || [] });
      }
    }

    duplicates.sort((a, b) => a.key.localeCompare(b.key));
    return duplicates;
  }

  function auditRepeatedValues(dict) {
    const byValue = new Map();

    for (const [k, v] of Object.entries(dict || {})) {
      if (typeof v !== "string") continue;
      const normalized = v.trim();
      if (normalized.length < I18N_AUDIT.repeatedValueMinLength) continue;
      if (!byValue.has(normalized)) byValue.set(normalized, []);
      byValue.get(normalized).push(k);
    }

    const repeated = [];
    for (const [value, keys] of byValue.entries()) {
      if (keys.length > 1) repeated.push({ value, keys });
    }

    repeated.sort((a, b) => b.keys.length - a.keys.length || a.value.localeCompare(b.value));
    return repeated;
  }

  function auditDict(dict, lang, rawText = "") {
    if (!I18N_AUDIT.enabled) return;

    const domKeys = collectDomI18nKeys(dict);
    const dictKeys = Object.keys(dict || {});

    const missing = [];
    for (const key of domKeys) {
      if (typeof dict?.[key] !== "string") missing.push(key);
    }

    const unused = [];
    for (const key of dictKeys) {
      if (!domKeys.has(key)) unused.push(key);
    }

    if (I18N_AUDIT.warnMissingKeys && missing.length > 0) {
      console.warn(
        `[i18n][${lang}] ${missing.length} chave(s) usadas na página mas ausentes no JSON: ` +
        listPreview(missing, I18N_AUDIT.maxListPreview)
      );
    }

    if (I18N_AUDIT.warnUnusedKeys && unused.length > 0) {
      console.warn(
        `[i18n][${lang}] ${unused.length} chave(s) no JSON sem uso na página atual: ` +
        listPreview(unused, I18N_AUDIT.maxListPreview)
      );
    }

    if (I18N_AUDIT.warnDuplicateKeys && rawText) {
      const duplicates = scanDuplicateJsonKeys(rawText);
      if (duplicates.length > 0) {
        const preview = duplicates
          .slice(0, I18N_AUDIT.maxListPreview)
          .map((d) => `${d.key} x${d.count} (linhas ${d.lines.join("/")})`)
          .join(", ");
        const suffix = duplicates.length > I18N_AUDIT.maxListPreview
          ? ` ... (+${duplicates.length - I18N_AUDIT.maxListPreview})`
          : "";
        console.warn(`[i18n][${lang}] chave(s) duplicada(s) no JSON raw: ${preview}${suffix}`);
      }
    }

    if (I18N_AUDIT.warnRepeatedValues) {
      const repeatedValues = auditRepeatedValues(dict);
      if (repeatedValues.length > 0) {
        const preview = repeatedValues
          .slice(0, I18N_AUDIT.maxListPreview)
          .map((r) => `"${r.value}" -> [${r.keys.join(", ")}]`)
          .join(" | ");
        const suffix = repeatedValues.length > I18N_AUDIT.maxListPreview
          ? ` ... (+${repeatedValues.length - I18N_AUDIT.maxListPreview})`
          : "";
        console.warn(`[i18n][${lang}] valores repetidos (pode ser redundância): ${preview}${suffix}`);
      }
    }
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
      const dict = JSON.parse(text);
      return { dict, rawText: text };
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
      const { dict, rawText } = await fetchJsonStrict(url);
      return { lang: safe, dict, rawText };
    } catch (e) {
      if (e && e.name === "SyntaxError") warnInvalidJsonOnce(url, e);
      throw e;
    }
  }

  function getPageTitleKey(dict) {
    const htmlKey = document.documentElement.getAttribute("data-i18n-page-title");
    if (htmlKey && typeof dict?.[htmlKey] === "string") return htmlKey;

    const meta = document.querySelector('meta[name="i18n-page-title"][content]');
    const metaKey = meta ? meta.getAttribute("content") : null;
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
    const { lang: safeLang, dict, rawText } = await loadLang(normalized);

    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, safeLang); } catch {}
    }

    applyTranslations(dict, safeLang);
    auditDict(dict, safeLang, rawText);
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
