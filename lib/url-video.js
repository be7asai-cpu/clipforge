/**
 * Download a direct video URL to disk (http/https only).
 * No YouTube/TikTok scrapers — file must be a real media URL.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const dns = require("dns");
const { promisify } = require("util");
const lookup = promisify(dns.lookup);

const MAX_BYTES = Number(process.env.URL_VIDEO_MAX_BYTES) || 500 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.URL_VIDEO_TIMEOUT_MS) || 180000;
const MAX_REDIRECTS = 5;

const VIDEO_EXT = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
  ".mpeg",
  ".mpg",
  ".wmv",
  ".flv",
  ".3gp",
  ".ts",
  ".mts",
  ".m2ts",
]);

function isPrivateIp(ip) {
  if (!ip) return true;
  const s = String(ip).toLowerCase();
  if (s === "127.0.0.1" || s === "::1" || s === "0.0.0.0") return true;
  if (s.startsWith("10.")) return true;
  if (s.startsWith("192.168.")) return true;
  if (s.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(s)) return true;
  if (s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80")) return true;
  return false;
}

function extFromUrl(u) {
  try {
    const p = (u.pathname || "").split("?")[0];
    const ext = path.extname(p).toLowerCase();
    return ext || "";
  } catch {
    return "";
  }
}

function guessNameFromUrl(u, contentType) {
  const base = path.basename(u.pathname || "") || "video";
  let name = decodeURIComponent(base).replace(/[^\w.\-()+ ]+/g, "_").slice(0, 120);
  if (!path.extname(name)) {
    if (/webm/i.test(contentType || "")) name += ".webm";
    else if (/quicktime|mov/i.test(contentType || "")) name += ".mov";
    else name += ".mp4";
  }
  return name || "video.mp4";
}

const PLATFORM_HOST_RE =
  /(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)tiktok\.com$|(^|\.)instagram\.com$|(^|\.)facebook\.com$|(^|\.)fb\.watch$|(^|\.)fb\.com$|(^|\.)vimeo\.com$|(^|\.)twitter\.com$|(^|\.)x\.com$|(^|\.)reddit\.com$|(^|\.)redd\.it$|(^|\.)twitch\.tv$/i;

function platformName(host) {
  const h = String(host || "").toLowerCase();
  if (h.includes("youtu")) return "YouTube";
  if (h.includes("tiktok")) return "TikTok";
  if (h.includes("instagram")) return "Instagram";
  if (h.includes("facebook") || h.includes("fb.")) return "Facebook";
  if (h.includes("vimeo")) return "Vimeo";
  if (h.includes("twitter") || h === "x.com" || h.endsWith(".x.com"))
    return "X/Twitter";
  if (h.includes("reddit") || h.includes("redd.it")) return "Reddit";
  if (h.includes("twitch")) return "Twitch";
  return "platforma";
}

/**
 * Classify URL:
 * - direct: CDN file (.mp4…) — cloud or PC can download
 * - platform: YouTube/TikTok/… — only PC agent + yt-dlp
 * - invalid
 */
function classifyVideoUrl(urlStr) {
  let u;
  try {
    u = new URL(String(urlStr || "").trim());
  } catch {
    return { ok: false, kind: "invalid", error: "Nieprawidłowy adres URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return {
      ok: false,
      kind: "invalid",
      error: "Dozwolone tylko http:// i https://",
    };
  }
  const host = (u.hostname || "").toLowerCase();
  if (PLATFORM_HOST_RE.test(host)) {
    return {
      ok: true,
      kind: "platform",
      url: u,
      platform: platformName(host),
    };
  }
  const ext = extFromUrl(u);
  if (ext && !VIDEO_EXT.has(ext)) {
    return {
      ok: false,
      kind: "invalid",
      error:
        "Rozszerzenie nie wygląda na wideo (użyj .mp4, .webm, .mov… albo link YouTube przy PC · ON)",
    };
  }
  return { ok: true, kind: "direct", url: u };
}

/** @deprecated use classifyVideoUrl — kept for direct-only callers */
function looksLikeVideoUrl(urlStr) {
  const c = classifyVideoUrl(urlStr);
  if (!c.ok) return { ok: false, error: c.error };
  if (c.kind === "platform") {
    return {
      ok: false,
      error:
        "To link do platformy (" +
        (c.platform || "YouTube/TikTok") +
        "). Przy PC · ON agent pobierze go lokalnie (yt-dlp).",
      kind: "platform",
      platform: c.platform,
    };
  }
  return { ok: true, url: c.url, kind: "direct" };
}

async function assertPublicHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Adres lokalny / wewnętrzny jest zablokowany");
  }
  let addr;
  try {
    const r = await lookup(host, { all: false });
    addr = r && r.address ? r.address : r;
  } catch {
    throw new Error("Nie można rozwiązać hosta: " + host);
  }
  if (isPrivateIp(addr)) {
    throw new Error("Pobieranie z sieci prywatnej jest zablokowane");
  }
}

/**
 * @param {string} urlStr
 * @param {string} destPath
 * @returns {Promise<{ originalName: string, bytes: number, contentType: string }>}
 */
function downloadDirectVideo(urlStr, destPath, opts = {}) {
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const timeoutMs = opts.timeoutMs || TIMEOUT_MS;

  return new Promise(async (resolve, reject) => {
    const check = looksLikeVideoUrl(urlStr);
    if (!check.ok) return reject(new Error(check.error));
    const startUrl = check.url;

    try {
      await assertPublicHost(startUrl.hostname);
    } catch (e) {
      return reject(e);
    }

    let redirects = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {
        /* ignore */
      }
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const ok = (info) => {
      if (settled) return;
      settled = true;
      resolve(info);
    };

    function getOnce(currentUrl) {
      const lib = currentUrl.protocol === "https:" ? https : http;
      const req = lib.get(
        currentUrl,
        {
          timeout: timeoutMs,
          headers: {
            "User-Agent": "ClipForge-Studio/1.0 (+direct-video-fetch)",
            Accept: "video/*,application/octet-stream,*/*",
          },
        },
        (res) => {
          const code = res.statusCode || 0;
          if (
            code >= 300 &&
            code < 400 &&
            res.headers.location &&
            redirects < MAX_REDIRECTS
          ) {
            redirects++;
            res.resume();
            let next;
            try {
              next = new URL(res.headers.location, currentUrl);
            } catch {
              return fail(new Error("Zły redirect Location"));
            }
            if (next.protocol !== "http:" && next.protocol !== "https:") {
              return fail(new Error("Redirect do niedozwolonego protokołu"));
            }
            assertPublicHost(next.hostname)
              .then(() => getOnce(next))
              .catch(fail);
            return;
          }
          if (code < 200 || code >= 300) {
            res.resume();
            return fail(new Error("HTTP " + code + " przy pobieraniu wideo"));
          }

          const ct = String(res.headers["content-type"] || "").toLowerCase();
          const cl = Number(res.headers["content-length"] || 0);
          if (cl > maxBytes) {
            res.resume();
            return fail(
              new Error(
                "Plik za duży (" +
                  Math.round(cl / 1e6) +
                  " MB). Limit ~" +
                  Math.round(maxBytes / 1e6) +
                  " MB."
              )
            );
          }
          // Soft type check — many CDNs send octet-stream
          if (
            ct &&
            !/video\//.test(ct) &&
            !/octet-stream|binary|mpegurl|application\/mp4/.test(ct) &&
            !VIDEO_EXT.has(extFromUrl(currentUrl))
          ) {
            // still allow if extension looks like video
            if (!VIDEO_EXT.has(extFromUrl(currentUrl))) {
              res.resume();
              return fail(
                new Error(
                  "Serwer nie zwraca wideo (Content-Type: " +
                    (ct || "?") +
                    "). Potrzebny bezpośredni plik .mp4/.webm/…"
                )
              );
            }
          }

          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const out = fs.createWriteStream(destPath);
          let bytes = 0;
          res.on("data", (chunk) => {
            bytes += chunk.length;
            if (bytes > maxBytes) {
              res.destroy();
              out.destroy();
              fail(
                new Error(
                  "Przekroczono limit " + Math.round(maxBytes / 1e6) + " MB"
                )
              );
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            if (bytes < 64) {
              return fail(new Error("Pobrany plik jest pusty / za mały"));
            }
            // Reject obvious HTML error pages saved as "video"
            try {
              const fd = fs.openSync(destPath, "r");
              const buf = Buffer.alloc(16);
              fs.readSync(fd, buf, 0, 16, 0);
              fs.closeSync(fd);
              const head = buf.toString("utf8");
              if (/^\s*</.test(head) || head.startsWith("{")) {
                return fail(
                  new Error(
                    "Pobrano HTML/JSON zamiast wideo — to nie jest bezpośredni link do pliku"
                  )
                );
              }
            } catch {
              /* ignore peek errors */
            }
            ok({
              originalName: guessNameFromUrl(currentUrl, ct),
              bytes,
              contentType: ct || "video/mp4",
            });
          });
          out.on("error", fail);
          res.on("error", fail);
        }
      );
      req.on("timeout", () => {
        req.destroy();
        fail(new Error("Timeout pobierania (" + Math.round(timeoutMs / 1000) + "s)"));
      });
      req.on("error", fail);
    }

    getOnce(startUrl);
  });
}

module.exports = {
  looksLikeVideoUrl,
  classifyVideoUrl,
  platformName,
  downloadDirectVideo,
  MAX_BYTES,
  VIDEO_EXT,
  PLATFORM_HOST_RE,
};
