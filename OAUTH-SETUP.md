# Logowanie Google + Facebook — ClipForge

Kod OAuth **jest już w projekcie**. Ty tylko zakładasz aplikacje u Google/Meta i wklejasz klucze do `.env`.

**Interaktywna ściąga (gdy serwer działa):**  
http://localhost:3847/oauth-setup.html

---

## 0. Przed startem

1. Serwer ClipForge działa (`npm start` / skrót).
2. W `.env` ustaw **ten sam adres**, którego używasz w przeglądarce:

```env
BASE_URL=http://localhost:3847
```

Otwieraj zawsze **http://localhost:3847** (nie mieszaj z `127.0.0.1` — sesja OAuth się psuje).

---

## 1. Google (ok. 5–10 min)

1. Wejdź: https://console.cloud.google.com/apis/credentials  
2. Utwórz projekt → np. **ClipForge**.  
3. **OAuth consent screen**  
   - User type: **External**  
   - App name: ClipForge  
   - Support email: Twój  
   - Test users: **dodaj swój Gmail** (w trybie Testing tylko oni mogą się logować)  
4. **Credentials → + Create credentials → OAuth client ID**  
   - Application type: **Web application**  
   - Name: ClipForge Web  
   - **Authorized JavaScript origins:**  
     `http://localhost:3847`  
   - **Authorized redirect URIs:**  
     `http://localhost:3847/api/auth/google/callback`  
5. Skopiuj **Client ID** i **Client secret**.

W `.env`:

```env
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
```

---

## 2. Facebook / Meta (ok. 10–15 min)

1. Wejdź: https://developers.facebook.com/apps  
2. **Create App** → typ pod logowanie użytkowników (Consumer / Authenticate).  
3. Dodaj produkt **Facebook Login → Web**.  
4. **Settings → Basic**  
   - skopiuj **App ID** i **App Secret**  
5. **Facebook Login → Settings**  
   - **Valid OAuth Redirect URIs:**  
     `http://localhost:3847/api/auth/facebook/callback`  
   - Zapisz.  
6. **Roles** → dodaj siebie jako Administrator (w Development tylko role mogą się logować).  
7. Uprawnienia: `email`, `public_profile` (domyślne do logowania).

W `.env`:

```env
FACEBOOK_APP_ID=1234567890
FACEBOOK_APP_SECRET=abcdef...
```

**Uwaga:** w trybie **Development** Facebook nie wpuszcza „całego internetu” — tylko testerów z Roles. Na publiczny login trzeba App Review (później).

---

## 3. Zapis i restart

1. Zapisz `Projects/clips-tv/.env`  
2. Zrestartuj ClipForge (zamknij okno serwera → odpal ponownie).  
3. Wejdź: http://localhost:3847/login.html  
4. Przyciski Google / Facebook **nie powinny być szare**.  
5. Kliknij → zgoda → powinieneś wpaść do Studio zalogowany.

Sprawdzenie statusu:

```text
http://localhost:3847/api/auth/providers
```

`"google": true` / `"facebook": true` = klucze wczytane.

---

## 4. Typowe błędy

| Objaw | Przyczyna |
|--------|-----------|
| Przycisk szary | Puste klucze w `.env` albo brak restartu |
| `redirect_uri_mismatch` | URI w konsoli ≠ `BASE_URL` + `/api/auth/.../callback` |
| Po Google wraca na login | Mieszasz `localhost` i `127.0.0.1` |
| Facebook: „App not set up” | Brak produktu Facebook Login albo zły redirect |
| Facebook: tylko Ty możesz | Development mode — dodaj testerów w Roles |

---

## 5. Produkcja (później, gdy będzie domena)

W konsolach dodaj **drugie** origin + redirect, np.:

- `https://twoja-domena.pl`  
- `https://twoja-domena.pl/api/auth/google/callback`  
- `https://twoja-domena.pl/api/auth/facebook/callback`  

W `.env` na serwerze:

```env
BASE_URL=https://twoja-domena.pl
COOKIE_SECURE=true
TRUST_PROXY=1
```

---

## Co już robi kod (nie musisz pisać)

- `passport-google-oauth20` + `passport-facebook`  
- Trasy: `/api/auth/google`, `/api/auth/google/callback`, to samo dla Facebook  
- Tworzenie / łączenie konta po e-mailu  
- Przyciski na `login.html` i w bramce Studio  

Po wklejeniu kluczy **od razu działa**.
