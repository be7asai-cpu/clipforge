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
  /* ---------- setup guide (visible before any account is connected) ---------- */
  const HELP = [
    { p: "youtube", label: "YouTube", img: ["youtube-credentials.png", "youtube-playground.png"], steps: 6, k: "yt",
      links: [["Google Cloud Console — Credentials", "https://console.cloud.google.com/apis/credentials"],
              ["YouTube Data API v3 (włącz)", "https://console.cloud.google.com/apis/library/youtube.googleapis.com"],
              ["OAuth consent screen", "https://console.cloud.google.com/apis/credentials/consent"],
              ["OAuth 2.0 Playground", "https://developers.google.com/oauthplayground"]],
      copy: ["https://www.googleapis.com/auth/youtube.upload", "https://developers.google.com/oauthplayground"] },
    { p: "facebook", label: "Facebook Page", img: ["meta-token.png"], steps: 4, k: "fb",
      links: [["Meta for Developers — My Apps", "https://developers.facebook.com/apps/"],
              ["Graph API Explorer", "https://developers.facebook.com/tools/explorer/"],
              ["Access Token Debugger", "https://developers.facebook.com/tools/debug/accesstoken/"]],
      copy: ["pages_manage_posts,pages_read_engagement,pages_show_list,publish_video,instagram_basic,instagram_content_publish", "me/accounts"] },
    { p: "instagram", label: "Instagram Reels", img: [], steps: 3, k: "ig",
      links: [["IG Content Publishing docs", "https://developers.facebook.com/docs/instagram-platform/content-publishing"]],
      copy: ["{page-id}?fields=instagram_business_account", "instagram_basic,instagram_content_publish,pages_show_list"] },
    { p: "tiktok", label: "TikTok", img: ["tiktok-app.png"], steps: 4, k: "tt",
      links: [["TikTok for Developers — Manage apps", "https://developers.tiktok.com/apps/"],
              ["Content Posting API — start", "https://developers.tiktok.com/doc/content-posting-api-get-started"],
              ["OAuth user access token", "https://developers.tiktok.com/doc/oauth-user-access-token-management"]],
      copy: ["user.info.basic,video.upload,video.publish", "https://open.tiktokapis.com/v2/oauth/token/"] },
    { p: "x", label: "X (Twitter)", img: ["x-keys.png"], steps: 4, k: "x",
      links: [["X Developer Portal", "https://developer.x.com/en/portal/dashboard"],
              ["Media upload docs", "https://docs.x.com/x-api/media/quickstart/media-upload-chunked"]],
      copy: ["Read and write", "https://api.x.com/2/tweets"] },
  ];
  function renderHelp() {
    const box = $("#social-help-body");
    if (!box) return;
    box.innerHTML = HELP.map((h) => `<div class="help-plat"><h5>${esc(h.label)}</h5>
      <ol>${Array.from({ length: h.steps }, (_, i) => `<li>${esc(tr(`help.${h.k}.${i + 1}`, ""))}</li>`).join("")}</ol>
      ${h.links.map(([t, u]) => `<div class="help-copy"><a href="${u}" target="_blank" rel="noopener">${esc(t)} ↗</a></div>`).join("")}
      ${h.copy.map((c) => `<div class="help-copy"><code>${esc(c)}</code><button type="button" class="btn ghost sm" data-copy="${esc(c)}">${esc(tr("social.copy", "Kopiuj"))}</button></div>`).join("")}
      ${h.img.map((i) => `<a href="/assets/social-help/${i}" target="_blank"><img loading="lazy" src="/assets/social-help/${i}" alt="${esc(h.label)} — ${esc(i)}"/></a>`).join("")}
    </div>`).join("");
    box.querySelectorAll("[data-copy]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(b.dataset.copy);
        } catch {
          const t = document.createElement("textarea");
          t.value = b.dataset.copy;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          t.remove();
        }
        b.textContent = tr("social.copied", "Skopiowano ✓");
        setTimeout(() => (b.textContent = tr("social.copy", "Kopiuj")), 1500);
      })
    );
  }

  /* ---------- source: finished job or disk clip ---------- */
  let diskPick = null; // { id, name }
  function currentJobId() {
    return $("#result-export")?.dataset?.jobId || $("#btn-retry")?.dataset?.jobId || "";
  }
  function renderSource() {
    const el = $("#social-source");
    if (!el) return;
    const jid = currentJobId();
    const txt = diskPick
      ? `${tr("social.srcDisk", "z dysku")}: ${diskPick.name}`
      : jid
      ? `${tr("social.srcJob", "gotowy klip")} (${jid.slice(0, 8)})`
      : tr("social.srcNone", "brak");
    el.innerHTML = `${esc(tr("social.src", "Źródło"))}: ${esc(txt)}${diskPick ? ` <button type="button" class="btn ghost sm" id="social-src-clear">✕</button>` : ""}`;
    $("#social-src-clear")?.addEventListener("click", () => {
      diskPick = null;
      renderSource();
      loadDisk();
    });
  }
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";

  /* ---------- Mój dysk ---------- */
  async function loadDisk() {
    const list = $("#disk-list");
    if (!list) return;
    let d;
    try {
      d = await api("/api/studio/disk");
    } catch (e) {
      list.innerHTML = `<li>${esc(e.message)}</li>`;
      return;
    }
    const pct = Math.min(100, (d.used / d.quota) * 100);
    $("#disk-bar-fill").style.width = pct + "%";
    $("#disk-bar-fill").classList.toggle("full", pct > 95);
    $("#disk-usage").textContent = `${tr("disk.used", "Zajęte")}: ${mb(d.used)} / ${mb(d.quota)} · ${mb(d.free)} ${tr("disk.free", "wolne")}`;
    list.innerHTML = d.items.length
      ? d.items.map((i) => `<li class="${diskPick?.id === i.id ? "sel" : ""}" data-id="${i.id}">
          ${i.hasThumb ? `<img src="/api/studio/disk/${i.id}/thumb" alt=""/>` : "🎬"}
          <span class="nm">${esc(i.title || i.name)} · ${mb(i.size)} · ${esc(new Date(i.createdAt).toLocaleString())}</span>
          <button type="button" class="btn primary sm" data-a="use">${esc(tr("disk.use", "Użyj do publikacji"))}</button>
          <a class="btn ghost sm" href="/api/studio/disk/${i.id}/file?dl=1">⬇</a>
          <button type="button" class="btn ghost sm" data-a="del">${esc(tr("disk.del", "Usuń"))}</button></li>`).join("")
      : `<li>${esc(tr("disk.empty", "Dysk jest pusty."))}</li>`;
    list.querySelectorAll("li[data-id] button").forEach((b) =>
      b.addEventListener("click", async () => {
        const li = b.closest("li");
        const it = d.items.find((x) => x.id === li.dataset.id);
        if (b.dataset.a === "use") {
          diskPick = { id: it.id, name: it.title || it.name };
          if (it.title && !$("#social-title").value) $("#social-title").value = it.title;
          if (it.description && !$("#social-desc").value) $("#social-desc").value = it.description;
          renderSource();
          loadDisk();
          $("#social-pub")?.scrollIntoView({ behavior: "smooth", block: "start" });
        } else if (confirm(tr("disk.confirmDel", "Usunąć klip z dysku?"))) {
          await api(`/api/studio/disk/${it.id}`, { method: "DELETE" }).catch(() => {});
          if (diskPick?.id === it.id) diskPick = null;
          renderSource();
          loadDisk();
        }
      })
    );
  }
  async function diskSaveJob() {
    const jid = currentJobId();
    const u = $("#disk-usage");
    if (!jid) return (u.textContent = tr("social.noJob", "Brak gotowego klipu"));
    u.textContent = tr("disk.saving", "Zapisywanie…");
    try {
      await api("/api/studio/disk/from-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: jid, title: $("#social-title").value.trim(), description: $("#social-desc").value.trim() }),
      });
    } catch (e) {
      alert(e.message);
    }
    loadDisk();
  }
  async function diskUpload(file) {
    if (!file) return;
    $("#disk-usage").textContent = tr("disk.saving", "Zapisywanie…");
    const fd = new FormData();
    fd.append("video", file);
    try {
      await api("/api/studio/disk", { method: "POST", body: fd });
    } catch (e) {
      alert(e.message);
    }
    $("#disk-upload").value = "";
    loadDisk();
  }

  /* ---------- publish / schedule ---------- */
  function buildForm(platforms) {
    const fd = new FormData();
    fd.append("platforms", JSON.stringify(platforms));
    fd.append("title", $("#social-title").value.trim());
    fd.append("description", $("#social-desc").value.trim());
    const video = $("#social-video")?.files?.[0];
    if (video) fd.append("video", video);
    else if (diskPick) fd.append("diskId", diskPick.id);
    else if (currentJobId()) fd.append("jobId", currentJobId());
    else return null;
    const thumb = $("#social-thumb")?.files?.[0];
    if (thumb) fd.append("thumb", thumb);
    const tu = $("#social-thumb-url").value.trim();
    if (tu) fd.append("thumbUrl", tu);
    return fd;
  }
  const labelOf = (p) => accounts.find((a) => a.platform === p)?.label || p;
  function resultsHtml(results) {
    return (results || [])
      .map((r) =>
        r.ok
          ? `<div class="ok">✓ ${esc(labelOf(r.platform))}: ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>` : esc(tr("social.sent", "wysłano"))}</div>` +
            (r.warning ? `<div class="warn">⚠ ${esc(r.warning)}</div>` : "")
          : `<div class="err">✗ ${esc(labelOf(r.platform))}: ${esc(r.error)}</div>`
      )
      .join("");
  }
  async function publish(all) {
    const out = $("#social-results");
    let platforms = [...selected];
    if (all === true) {
      platforms = accounts.filter((a) => a.connected).map((a) => a.platform);
      platforms.forEach((p) => selected.add(p));
      renderChips();
      if (!platforms.length) return (out.innerHTML = `<div class="err">${esc(tr("social.noneConnected", "Brak połączonych kont"))}</div>`);
    }
    if (!platforms.length) return (out.innerHTML = `<div class="err">${esc(tr("social.pickOne", "Zaznacz co najmniej jedno połączone konto."))}</div>`);
    const fd = buildForm(platforms);
    if (!fd) return (out.innerHTML = `<div class="err">${esc(tr("social.noJob", "Brak gotowego klipu — zakończ zadanie albo wybierz plik."))}</div>`);
    const btns = [$("#social-publish"), $("#social-publish-all")];
    btns.forEach((b) => b && (b.disabled = true));
    out.innerHTML = `<div>${esc(tr("social.sending", "Wysyłanie…"))}</div>`;
    try {
      const d = await api("/api/studio/social/publish", { method: "POST", body: fd });
      out.innerHTML = resultsHtml(d.results);
    } catch (e) {
      out.innerHTML = `<div class="err">✗ ${esc(e.message)}</div>`;
    } finally {
      btns.forEach((b) => b && (b.disabled = false));
    }
  }
  async function schedule() {
    const out = $("#social-results");
    const platforms = [...selected];
    if (!platforms.length) return (out.innerHTML = `<div class="err">${esc(tr("social.pickOne", "Zaznacz konto"))}</div>`);
    const fd = buildForm(platforms);
    if (!fd) return (out.innerHTML = `<div class="err">${esc(tr("social.noJob", "Brak klipu"))}</div>`);
    const w = $("#social-when").value; // local time (browser zone) → UTC ISO
    if (w) fd.append("runAt", new Date(w).toISOString());
    try {
      await api("/api/studio/social/queue", { method: "POST", body: fd });
      out.innerHTML = `<div class="ok">✓ ${esc(tr("social.queued", "Dodano do kolejki"))}</div>`;
    } catch (e) {
      out.innerHTML = `<div class="err">✗ ${esc(e.message)}</div>`;
    }
    loadQueue();
    loadDisk();
  }
  const fmtWhen = (iso) => {
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };
  const toLocalInput = (iso) => {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  async function loadQueue() {
    const ul = $("#social-queue");
    if (!ul) return;
    let items = [];
    try {
      items = (await api("/api/studio/social/queue")).items || [];
    } catch (e) {
      ul.innerHTML = `<li>${esc(e.message)}</li>`;
      return;
    }
    ul.innerHTML = items.length
      ? items.map((q) => `<li data-id="${q.id}">
          <span class="st ${q.status}">${esc(tr("st." + q.status, q.status))}</span>
          <span class="nm">${esc(fmtWhen(q.runAt))} → ${esc(q.platforms.map(labelOf).join(", "))} · ${esc(q.title || "—")}
            ${q.videoSource?.diskId ? "💾" : "🎬"}</span>
          ${q.status === "pending"
            ? `<input type="datetime-local" value="${toLocalInput(q.runAt)}" data-a="when"/>
               <button type="button" class="btn ghost sm" data-a="edit">${esc(tr("social.edit", "Zmień godzinę"))}</button>
               <button type="button" class="btn ghost sm" data-a="del">${esc(tr("social.cancel", "Anuluj"))}</button>`
            : q.status !== "running"
            ? `<button type="button" class="btn ghost sm" data-a="del">${esc(tr("social.clear", "Wyczyść"))}</button>`
            : ""}
          ${q.results ? `<div class="social-results" style="flex-basis:100%">${resultsHtml(q.results)}</div>` : ""}
        </li>`).join("")
      : `<li>${esc(tr("social.queueEmpty", "Brak zaplanowanych publikacji."))}</li>`;
    ul.querySelectorAll("button[data-a]").forEach((b) =>
      b.addEventListener("click", async () => {
        const li = b.closest("li");
        const id = li.dataset.id;
        try {
          if (b.dataset.a === "del") await api(`/api/studio/social/queue/${id}`, { method: "DELETE" });
          else {
            const v = li.querySelector('[data-a="when"]').value;
            await api(`/api/studio/social/queue/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runAt: new Date(v).toISOString() }),
            });
          }
        } catch (e) {
          alert(e.message);
        }
        loadQueue();
      })
    );
  }
  function init() {
    if (!$("#social-pub")) return;
    renderHelp();
    $("#social-open-keys").addEventListener("click", () => {
      renderForm();
      $("#social-dialog").showModal();
      load();
    });
    $("#social-publish").addEventListener("click", () => publish(false));
    $("#social-publish-all")?.addEventListener("click", () => publish(true));
    $("#social-schedule")?.addEventListener("click", schedule);
    $("#disk-save-job")?.addEventListener("click", diskSaveJob);
    $("#disk-upload")?.addEventListener("change", (e) => diskUpload(e.target.files[0]));
    load().then(() => {
      if (!accounts.some((a) => a.connected)) $("#social-help").open = true;
      loadQueue();
    });
    loadDisk();
    renderSource();
    setInterval(renderSource, 4000);
    setInterval(() => {
      if (document.visibilityState === "visible") loadQueue();
    }, 30000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
