(() => {
  "use strict";

  const API_BASE = "https://api-solarai.duckdns.org";
  const REQUEST_TIMEOUT_MS = 180000;
  const HEALTH_TIMEOUT_MS = 7000;
  const MAX_TOKENS = 500;

  const SESSION_KEY = "solarai_session_id";
  const TOKEN_KEY = "solarai_api_token";
  const LANG_KEY = "solarai_language";

  const apiStatus = document.getElementById("apiStatus");
  const apiStatusText = document.getElementById("apiStatusText");
  const chatArea = document.getElementById("chatArea");
  const promptEl = document.getElementById("prompt");
  const sendBtn = document.getElementById("sendBtn");
  const clearBtn = document.getElementById("clearBtn");
  const newChatBtn = document.getElementById("newChatBtn");

  if (!apiStatus || !chatArea || !promptEl || !sendBtn || !clearBtn || !newChatBtn) return;

  let isStreaming = false;
  let sessionId = loadOrCreateSessionId();
  let pendingReset = false;

  function t(id, fallback) {
    const el = document.getElementById(id);
    const txt = (el && el.textContent ? el.textContent : "").trim();
    return txt || fallback;
  }

  function updateI18nDependentText() {
    promptEl.placeholder = t("t_placeholder", "Type your message...");
    setStatus("checking");
  }

  function makeSessionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadOrCreateSessionId() {
    let sid = (localStorage.getItem(SESSION_KEY) || "").trim();
    if (!sid) {
      sid = makeSessionId();
      localStorage.setItem(SESSION_KEY, sid);
    }
    return sid;
  }

  function setSessionId(sid) {
    const cleaned = (sid || "").trim();
    if (!cleaned) return;
    sessionId = cleaned;
    localStorage.setItem(SESSION_KEY, cleaned);
  }

  function getApiToken() {
    return (localStorage.getItem(TOKEN_KEY) || "").trim();
  }

  function getLanguage() {
    return (localStorage.getItem(LANG_KEY) || document.documentElement.lang || "auto").trim() || "auto";
  }

  function nowApiFormat() {
    return new Date().toISOString().slice(0, 19).replace("T", " ");
  }

  function setStatus(state) {
    apiStatus.classList.remove("online", "offline");
    if (state === "online") {
      apiStatus.classList.add("online");
      apiStatusText.textContent = t("t_online", "Online");
      return;
    }
    if (state === "offline") {
      apiStatus.classList.add("offline");
      apiStatusText.textContent = t("t_offline", "Offline");
      return;
    }
    apiStatus.classList.add("offline");
    apiStatusText.textContent = t("t_checking", "Checking...");
  }

  function renderMarkdown(text) {
    const source = text || "";
    const markedApi = window.marked && typeof window.marked.parse === "function";
    const raw = markedApi ? window.marked.parse(source) : source
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");

    if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
      return window.DOMPurify.sanitize(raw);
    }
    return raw;
  }

  function scrollBottom() {
    chatArea.scrollTop = chatArea.scrollHeight;
  }

  function addBubble(text, who) {
    const div = document.createElement("div");
    div.className = `bubble ${who}`;
    if (who === "ai") {
      div.innerHTML = renderMarkdown(text || "...");
    } else {
      div.textContent = text || "";
    }
    chatArea.appendChild(div);
    scrollBottom();
    return div;
  }

  function buildPayload(prompt, stream) {
    return {
      prompt: (prompt || "").trim(),
      language: getLanguage(),
      data_e_hora: nowApiFormat(),
      stream: !!stream,
      max_tokens: MAX_TOKENS,
      session_id: sessionId,
      reset: !!pendingReset,
      token: getApiToken(),
      system_prompt: ""
    };
  }

  async function readErrorMessage(resp) {
    let txt = "";
    try { txt = await resp.text(); } catch {}
    if (!txt) return `HTTP ${resp.status}`;

    try {
      const obj = JSON.parse(txt);
      const detail = obj.detail || obj.error || obj.message || obj.text;
      if (detail) return `HTTP ${resp.status}: ${String(detail).slice(0, 300)}`;
    } catch {}

    return `HTTP ${resp.status}: ${txt.slice(0, 300)}`;
  }

  async function checkHealth() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/health`, { signal: controller.signal });
      if (res.ok) {
        setStatus("online");
        return true;
      }
    } catch {}
    finally {
      clearTimeout(timer);
    }

    setStatus("offline");
    return false;
  }

  async function runStreamGenerate(prompt, aiBubble) {
    const payload = buildPayload(prompt, true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) throw new Error(await readErrorMessage(res));

      const sidHeader = (res.headers.get("x-solarai-session") || "").trim();
      if (sidHeader) setSessionId(sidHeader);
      if (!res.body) return "";

      let acc = "";
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;
        acc += decoder.decode(value, { stream: true });
        aiBubble.innerHTML = renderMarkdown(acc);
        scrollBottom();
      }

      acc += decoder.decode();
      return acc;
    } finally {
      clearTimeout(timer);
    }
  }

  async function runOneShotGenerate(prompt) {
    const payload = buildPayload(prompt, false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok) throw new Error(await readErrorMessage(res));

      const data = await res.json();
      const text = data?.text ? String(data.text).trim() : "";
      const sid = data?.session_id ? String(data.session_id).trim() : "";
      if (sid) setSessionId(sid);
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send() {
    if (isStreaming) return;

    const prompt = (promptEl.value || "").trim();
    if (!prompt) return;

    addBubble(prompt, "user");
    promptEl.value = "";

    const online = await checkHealth();
    if (!online) {
      addBubble(t("t_offline_msg", "SolarAI is offline right now."), "ai");
      return;
    }

    const aiBubble = addBubble("...", "ai");
    isStreaming = true;
    sendBtn.disabled = true;

    let acc = "";
    let serverTouched = false;

    try {
      try {
        acc = await runStreamGenerate(prompt, aiBubble);
        serverTouched = true;
      } catch (streamErr) {
        if (acc.trim()) {
          aiBubble.innerHTML = renderMarkdown(`${acc}\n\n_[${t("t_stream_interrupted", "stream interrupted")}]_\n${String(streamErr)}`);
        }
      }

      if (!acc.trim()) {
        acc = await runOneShotGenerate(prompt);
        serverTouched = true;
        aiBubble.innerHTML = renderMarkdown(acc || t("t_no_response", "No response."));
        scrollBottom();
      }
    } catch (err) {
      aiBubble.innerHTML = renderMarkdown(`${t("t_error_msg", "Request failed.")}\n\n${String(err)}`);
    } finally {
      if (serverTouched) pendingReset = false;
      isStreaming = false;
      sendBtn.disabled = false;
      promptEl.focus();
    }
  }

  function newChat() {
    chatArea.innerHTML = "";
    setSessionId(makeSessionId());
    pendingReset = true;
    promptEl.focus();
  }

  clearBtn.addEventListener("click", () => {
    chatArea.innerHTML = "";
    promptEl.focus();
  });
  newChatBtn.addEventListener("click", newChat);
  sendBtn.addEventListener("click", send);

  promptEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  });

  document.addEventListener("i18n:updated", updateI18nDependentText);

  updateI18nDependentText();
  setTimeout(checkHealth, 100);
  setInterval(checkHealth, 15000);
})();
