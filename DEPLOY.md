# Publikacja ClipForge — darmowy host (Render)

## Co jest w repo

- `Dockerfile` — Node 20 + FFmpeg + Python STT  
- `render.yaml` — usługa **free** na [Render.com](https://render.com)  
- Bez katalogów z filmami (tylko Studio)

## Ograniczenia free tier

| | |
|--|--|
| Plan | Free (usypia po ~15 min bez ruchu) |
| RAM | ~512 MB — lekkie joby OK, ciężkie AI mogą paść |
| Dysk | tymczasowy — pliki znikają po restarcie |
| Real-ESRGAN | **nie** w obrazie Docker (brak GPU / binarek Windows) — użyj **Szybki HD** / lektor |
| Pierwszy start | 1–3 min (cold start) |

To jest **demo / test w chmurze**. Na co dzień lepiej nadal lokalny PC.

---

## Krok po kroku (ok. 15 min)

### 1. Konto GitHub
1. https://github.com/signup (jeśli nie masz)  
2. New repository → np. `clipforge-studio` → **Private** zalecane  

### 2. Wrzuć kod

Na PC (w folderze projektu, z zainstalowanym Gitem):

```powershell
cd C:\Users\londy\Projects\clips-tv
git init
git add Dockerfile .dockerignore render.yaml package.json package-lock.json server.js lib public .env.example .gitignore DEPLOY.md README.md
git commit -m "ClipForge Studio — deploy free Render"
git branch -M main
git remote add origin https://github.com/TWOJ_USER/clipforge-studio.git
git push -u origin main
```

**Nigdy nie commituj pliku `.env`** (hasła SMTP).

### 3. Render
1. https://dashboard.render.com → Sign up (przez GitHub)  
2. **New → Blueprint** → wybierz repo `clipforge-studio`  
   *albo* **New → Web Service** → repo → **Docker** → plan **Free**  
3. Po deployu dostaniesz URL:  
   `https://clipforge-studio-xxxx.onrender.com`  

### 4. Zmienne środowiskowe (Render → Environment)

| Klucz | Wartość |
|--------|---------|
| `BASE_URL` | `https://clipforge-studio-xxxx.onrender.com` (Twój URL) |
| `SESSION_SECRET` | długi losowy ciąg (lub auto z blueprint) |
| `TRUST_PROXY` | `1` |
| `COOKIE_SECURE` | `1` |
| `AUTH_REQUIRED` | `true` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | Twój Gmail |
| `SMTP_PASS` | hasło aplikacji Gmail |
| `SMTP_FROM` | `ClipForge <twoj@gmail.com>` |

Google/Facebook OAuth — **później**, gdy URL jest stały.

### 5. Test
1. Otwórz `https://….onrender.com`  
2. Zarejestruj się e-mailem (link aktywacyjny na mail)  
3. Wejdź do Studio  

Pierwsze wejście po snie free planu: **poczekaj 30–90 s**.

---

## Alternatywa bez chmury (PC włączony)

Darmowy tunel HTTPS na Twój lokalny ClipForge:

```powershell
npx --yes cloudflared tunnel --url http://127.0.0.1:3847
```

Dostaniesz link `https://….trycloudflare.com` — działa tylko gdy PC i ClipForge są włączone.

---

## Po publikacji

1. Ustaw `BASE_URL` na HTTPS URL  
2. Dopiero potem Google/Facebook OAuth z redirectami pod ten URL  
3. Nie wrzucaj katalogu `data/videos` na host — to nie jest serwer filmów
