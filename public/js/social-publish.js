/** ClipForge Studio — publish finished clip to user-connected social accounts. */
(() => {
  const $ = (s) => document.querySelector(s);
  const tr = (k, f) => (window.ClipForgeI18n && window.ClipForgeI18n.t(k)) || f || k;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NOTES = {
    youtube: () => tr("social.noteYt", "Sam API key NIE wystarczy do uploadu. Utwórz OAuth Client (Desktop/Web) w Google Cloud Console, włącz YouTube Data API v3 i wygeneruj Refresh Token ze scope youtube.upload (np. OAuth Playground). Własna miniatura wymaga zweryfikowanego kanału."),
    facebook: () => tr("social.noteFb", "Page ID + długoterminowy Page Access Token (uprawnienia pages_manage_posts, pages_read_engagement, publish_video)."),
    instagram: () => tr("social.noteIg", "Konto IG Business/Creator połączone ze Stroną FB. Token z instagram_content_publish. Okładka tylko z publicznego URL (pole URL)."),
    tiktok: () => tr("social.noteTt", "Content Posting API. Tryb inbox (domyślny) wysyła wideo do skrzynki w aplikacji TikTok. Tryb direct wymaga zatwierdzenia aplikacji (bez review — tylko SELF_ONLY). TikTok nie obsługuje własnej miniatury przez API."),
    x: () => tr("social.noteX", "OAuth 1.0a: API Key/Secret + Access Token/Secret z uprawnieniem Read and Write. Tekst posta = tytuł + opis (max 280 znaków); brak własnej miniatury."),
  };
  let accounts = [];
  const selected = new Set();

  async function api(url, opts) {
    const r = await fetch(url, { credentials: "same-origin", ...opts });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.results) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }
  async function load() {
    try {
      accounts = (await api("/api/studio/social/accounts")).accounts || [];
    } catch (e) {
      accounts = [];
      $("#social-chips").innerHTML = `<span class="share-hint">${esc(e.message)}</span>`;
      return;
    }
    renderChips();
    if ($("#social-dialog")?.open) renderForm();
  }
  function renderChips() {
    const box = $("#social-chips");
    if (!box) return;
    for (const a of accounts) if (!a.connected) selected.delete(a.platform);
    box.innerHTML = accounts
      .map((a) => {
        const st = a.connected ? (a.tested && !a.tested.ok ? "⚠" : "✓") : "○";
        return `<label class="social-chip ${a.connected ? "" : "off"}" title="${esc(a.connected ? (a.tested?.info || "") : tr("social.notConnected", "Niepołączone"))}">
          <input type="checkbox" data-p="${a.platform}" ${a.connected ? "" : "disabled"} ${selected.has(a.platform) ? "checked" : ""}/> ${st} ${esc(a.label)}</label>`;
      })
      .join("");
    box.querySelectorAll("input[data-p]").forEach((i) =>
      i.addEventListener("change", () => (i.checked ? selected.add(i.dataset.p) : selected.delete(i.dataset.p)))
    );
  }
  function renderForm() {
    const box = $("#social-accounts-form");
    box.innerHTML = accounts
      .map(
        (a) => `<div class="social-acc" data-p="${a.platform}">
        <h4><span>${esc(a.label)} ${a.connected ? "✓" : ""}</span><a href="${esc(a.help)}" target="_blank" rel="noopener">${esc(tr("social.help", "Gdzie wziąć klucze?"))} ↗</a></h4>
        <div class="note">${esc(NOTES[a.platform]())}</div>
        ${a.unreadable ? `<div class="note err">${esc(tr("social.unreadable", "Zapisane klucze nieczytelne (zmieniono SOCIAL_SECRETS_KEY) — wpisz ponownie."))}</div>` : ""}
        ${a.fieldDefs
          .map(
            (f) => `<label>${esc(f.label)}${f.required ? " *" : ""}
            <input name="${f.key}" type="${f.secret ? "password" : "text"}" autocomplete="off" value="${esc(a.fields[f.key] || "")}" /></label>`
          )
          .join("")}
        <div class="row">
          <button type="button" class="btn primary sm" data-act="save">${esc(tr("social.save", "Zapisz"))}</button>
          <button type="button" class="btn ghost sm" data-act="test" ${a.connected ? "" : "disabled"}>${esc(tr("social.test", "Test połączenia"))}</button>
          <button type="button" class="btn ghost sm" data-act="del" ${a.saved ? "" : "disabled"}>${esc(tr("social.remove", "Usuń"))}</button>
          <span class="note" data-msg>${a.tested ? esc((a.tested.ok ? "✓ " : "✗ ") + a.tested.info) : ""}</span>
        </div></div>`
      )
      .join("");
    box.querySelectorAll(".social-acc").forEach((el) => {
      const p = el.dataset.p;
      const msg = el.querySelector("[data-msg]");
      el.querySelectorAll("button[data-act]").forEach((b) =>
        b.addEventListener("click", async () => {
          b.disabled = true;
          msg.textContent = "…";
          try {
            if (b.dataset.act === "save") {
              const fields = {};
              el.querySelectorAll("input[name]").forEach((i) => (fields[i.name] = i.value));
              await api(`/api/studio/social/accounts/${p}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields }),
              });
              await load();
              const t = await api(`/api/studio/social/accounts/${p}/test`, { method: "POST" }).catch((e) => ({ ok: false, error: e.message }));
              await load();
              void t;
              return;
            }
            if (b.dataset.act === "test") {
              const t = await api(`/api/studio/social/accounts/${p}/test`, { method: "POST" });
              msg.textContent = t.ok ? "✓ " + t.info : "✗ " + t.error;
              await load();
              return;
            }
            if (b.dataset.act === "del") {
              if (!confirm(tr("social.confirmDel", "Usunąć zapisane klucze?"))) return;
              await api(`/api/studio/social/accounts/${p}`, { method: "DELETE" });
              await load();
            }
          } catch (e) {
            msg.textContent = "✗ " + e.message;
          } finally {
            b.disabled = false;
          }
        })
      );
    });
  }
  function currentJobId() {
    return $("#result-export")?.dataset?.jobId || $("#btn-retry")?.dataset?.jobId || "";
  }
  async function publish() {
    const out = $("#social-results");
    const btn = $("#social-publish");
    const platforms = [...selected];
    if (!platforms.length) return (out.innerHTML = `<div class="err">${esc(tr("social.pickOne", "Zaznacz co najmniej jedno połączone konto."))}</div>`);
    const video = $("#social-video")?.files?.[0];
    const jobId = currentJobId();
    if (!video && !jobId) return (out.innerHTML = `<div class="err">${esc(tr("social.noJob", "Brak gotowego klipu — zakończ zadanie albo wybierz plik."))}</div>`);
    const fd = new FormData();
    fd.append("platforms", JSON.stringify(platforms));
    fd.append("title", $("#social-title").value.trim());
    fd.append("description", $("#social-desc").value.trim());
    if (jobId) fd.append("jobId", jobId);
    if (video) fd.append("video", video);
    const thumb = $("#social-thumb")?.files?.[0];
    if (thumb) fd.append("thumb", thumb);
    const tu = $("#social-thumb-url").value.trim();
    if (tu) fd.append("thumbUrl", tu);
    btn.disabled = true;
    out.innerHTML = `<div>${esc(tr("social.sending", "Wysyłanie… (duże pliki mogą potrwać kilka minut)"))}</div>`;
    try {
      const d = await api("/api/studio/social/publish", { method: "POST", body: fd });
      const label = (p) => accounts.find((a) => a.platform === p)?.label || p;
      out.innerHTML = (d.results || [])
        .map((r) =>
          r.ok
            ? `<div class="ok">✓ ${esc(label(r.platform))}: ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : esc(tr("social.sent", "wysłano"))}</div>` +
              (r.warning ? `<div class="warn">⚠ ${esc(r.warning)}</div>` : "")
            : `<div class="err">✗ ${esc(label(r.platform))}: ${esc(r.error)}</div>`
        )
        .join("");
    } catch (e) {
      out.innerHTML = `<div class="err">✗ ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  }
  function init() {
    if (!$("#social-pub")) return;
    $("#social-open-keys").addEventListener("click", () => {
      renderForm();
      $("#social-dialog").showModal();
      load();
    });
    $("#social-publish").addEventListener("click", publish);
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
