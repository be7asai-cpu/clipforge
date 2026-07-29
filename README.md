# ClipForge Studio (`clips-tv`)

**Tylko Studio** — lokalna kuźnia klipów (delogo, HD, lektor).  
**Nie hostujemy** biblioteki cudzych filmików. Upload = tymczasowa obróbka, pliki auto-usuwane (~2 h).

## Publikacja (darmowy host)

- **Stały free host (Render):** zobacz [`DEPLOY.md`](./DEPLOY.md) — Docker + free plan  
- **Szybki link HTTPS (PC włączony):** `start-public-tunnel.bat` albo  
  `npx cloudflared tunnel --url http://127.0.0.1:3847`  
  → adres `https://….trycloudflare.com` (tymczasowy)

## Model (na razie): każdy na swoim PC

- ClipForge **uruchamiasz u siebie** (`localhost:3847`).
- Render (FFmpeg, AI, STT, lektor) idzie **na mocy Twojego komputera**.
- Filmy **nie lecą** na wspólny serwer w chmurze — wynik zostaje na dysku.
- 100 osób = 100 osobnych instalacji / skrótów — bez wspólnej kolejki i bez Oracle.

Później (opcjonalnie): strona w sieci + lokalny worker; na razie **tylko lokalnie**.

Portal ClipWave (stary katalog) leży osobno: `Projects/clipwave` (port 3850) — nie jest częścią tej strony.

## Quick start

```bash
cd Projects/clips-tv
npm install
npm start
```

Albo skrót / `Uruchom ClipForge.vbs` / `start-clipforge.bat`.

Open **http://localhost:3847**

## Konta na jednym PC (opcjonalnie)

Jeśli na **jednym** komputerze loguje się kilka osób, każdy ma **własne joby** (userId):

- lista / postęp / reset → tylko swoje  
- pobieranie plików → tylko właściciel  

Samotny user: `AUTH_REQUIRED=false` → userId = `local`.

## Auth (ClipForge Studio)

Studio requires login by default (`AUTH_REQUIRED=true`).

| Method | Setup |
|--------|--------|
| **E-mail + hasło** | Rejestracja → **link aktywacyjny** na e-mail → potem logowanie |
| **Google** | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` w `.env` |
| **Facebook** | `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` w `.env` |

**Instrukcja krok po kroku:** [`OAUTH-SETUP.md`](./OAUTH-SETUP.md)  
**W przeglądarce (serwer włączony):** http://localhost:3847/oauth-setup.html

1. Skopiuj `.env.example` → `.env` i uzupełnij klucze.
2. OAuth redirect URIs (1:1 w konsoli Google/Meta):
   - Google: `http://localhost:3847/api/auth/google/callback`
   - Facebook: `http://localhost:3847/api/auth/facebook/callback`
3. Ustaw `BASE_URL=http://localhost:3847` i otwieraj Studio pod **localhost** (nie mieszaj z 127.0.0.1).
4. **SMTP** (prawdziwe maile aktywacyjne), np. Gmail App Password:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=twoj@gmail.com
   SMTP_PASS=xxxx xxxx xxxx xxxx
   SMTP_FROM="ClipForge <twoj@gmail.com>"
   ```
   Bez SMTP: link w konsoli serwera + `data/auth/outbox/` (+ przycisk w UI gdy `EMAIL_DEV_LINKS=true`).
5. Zrestartuj serwer.

Użytkownicy: `data/auth/users.json`. Sesja: cookie `clipforge.sid`.  
Aktywacja: `GET /api/auth/activate?token=…` · ponowne wysłanie: `POST /api/auth/resend-activation`.

Lokalnie bez logowania: `AUTH_REQUIRED=false` w `.env`.## Research dataset (AI film analysis thesis)

Private offline copy of **catalog metadata**, thumbnails, and optional video files for academic analysis.

```bash
# Full metadata export (~58k clips) — can take a while
npm run export

# Or a smaller slice first
npm run export:sample

# Resume interrupted export
npm run export:resume

# Thumbnails + YouTube URL list
node scripts/download-assets.js --thumbs --max 500 --youtube-urls --all-urls

# Download self-hosted MP4s (direct files via signed embed URLs)
node scripts/download-assets.js --videos --selfhosted-only --max 50

# Baseline EDA report for the thesis
node scripts/ai-baseline.js

# Balanced sample JSON for experiments
npm run sample
```

See **`data/README.md`** for the full field list and suggested AI tasks.

| Output | Path |
|--------|------|
| Metadata JSONL/CSV | `data/catalog/` |
| Thumbnails | `data/thumbnails/` |
| Videos (MP4) | `data/videos/` |
| yt-dlp list | `data/urls/youtube.txt` |
| EDA report | `data/analysis/` |

Local API after export:

- `GET /api/local/videos?limit=100`
- `GET /api/local/stats`
- Static: `/local/thumbnails/<id>.jpg`, `/local/videos/<id>.mp4`

## Notes

- ClipWave is **not affiliated** with filmiki.tv. Built for **private academic research**.
- Do **not** publish or redistribute the scraped dataset.
- Titles/descriptions are often Polish; use the **Polish voice** in the narrator for clearer TTS.
- Handle `PATHOLOGY` / +18 material carefully in any thesis demos.

## Stack

- Node.js + Express (static files + GraphQL proxy + local dataset)
- Vanilla ES modules (no build step)
- Research scripts under `scripts/`

## ClipWave (osobny projekt)

Portal **ClipWave** jest odłączony i leży w:

`C:\Users\londy\Projects\clipwave`

- Port ClipWave: **3850**
- Ten folder (clips-tv) = **ClipForge Studio** (+ historycznie portal na 3847)

