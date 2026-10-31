# AL2100 — Prywatny system operacyjny AI

Polskojęzyczny, produkcyjny system AI na Cloudflare Workers z pamięcią rozmowy, pamięcią globalną, wieloma dostawcami AI, projektami, plikami R2, studiem kodu, generowaniem obrazów i integracją GitHub.

## Architektura

- **Cloudflare Workers** — backend (`worker.js`)
- **D1** — dane użytkowników, rozmów, pamięci, projektów
- **KV** — rate limiting, cache
- **R2** — pliki i multimedia
- **Queue** — zadania asynchroniczne
- **Workers AI** — fallback dla dostawców AI
- **GitHub OAuth** — logowanie
- **AES-GCM** — szyfrowanie kluczy API użytkowników

## Wymagane sekrety (wrangler secret put)

- `GITHUB_CLIENT_ID` — Client ID aplikacji GitHub OAuth
- `GITHUB_CLIENT_SECRET` — Client Secret aplikacji GitHub OAuth
- `ENCRYPTION_KEY` — losowy ciąg min. 32 znaków do szyfrowania AES-GCM

## Sekrety GitHub Actions

- `CLOUDFLARE_API_TOKEN` — token z uprawnieniami Workers, D1, KV, R2, Queues
- `CLOUDFLARE_ACCOUNT_ID` — ID konta Cloudflare

## Wdrożenie

1. **Utwórz aplikację GitHub OAuth**
   - Homepage: `https://al2100.axelgadomski.workers.dev`
   - Callback: `https://al2100.axelgadomski.workers.dev/auth/github/callback`

2. **Ustaw sekrety Workers**
   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   wrangler secret put ENCRYPTION_KEY
