# AL2100

Prywatny system operacyjny AI.  
Jeden plik `AL2100.ax` + kompilator `axc.js`.

## Wdrożenie z iPhone’a (bez terminala)

### 1. Przygotuj pliki na komputerze lub w chmurze
Potrzebujesz tych plików w jednym folderze:
- AL2100.ax
- axc.js
- package.json
- wrangler.toml
- .gitignore
- .github/workflows/deploy.yml
- README.md

### 2. Utwórz repozytorium na GitHubie (Safari na iPhonie)

1. Otwórz Safari → https://github.com
2. Zaloguj się
3. Kliknij „+” → „New repository”
4. Nazwa: `al2100`
5. Public lub Private
6. **Nie** dodawaj README, .gitignore ani license
7. Create repository

### 3. Wrzuć pliki przez przeglądarkę

1. Wejdź w nowo utworzone repo
2. Kliknij „uploading an existing file”
3. Przeciągnij wszystkie pliki (AL2100.ax, axc.js, package.json, wrangler.toml, .gitignore, README.md)
4. Folder `.github` wrzuć jako archiwum ZIP albo utwórz ręcznie:
   - Kliknij „Create new file”
   - Ścieżka: `.github/workflows/deploy.yml`
   - Wklej zawartość pliku deploy.yml
5. Commit changes

### 4. Dodaj sekrety Cloudflare

1. W repozytorium → Settings → Secrets and variables → Actions
2. New repository secret

Dodaj dwa sekrety:

**CLOUDFLARE_API_TOKEN**
- Idź na https://dash.cloudflare.com
- My Profile → API Tokens → Create Token
- Szablon „Edit Cloudflare Workers”
- Skopiuj token
- Wklej jako sekret

**CLOUDFLARE_ACCOUNT_ID**
- Cloudflare Dashboard → wybierz konto
- Po prawej stronie skopiuj Account ID
- Wklej jako sekret

### 5. Uruchom wdrożenie

1. W repozytorium kliknij zakładkę **Actions**
2. Wybierz workflow „Deploy AL2100”
3. Kliknij „Run workflow” → „Run workflow”
4. Poczekaj 1–3 minuty
5. Po sukcesie Cloudflare poda publiczny adres (np. `https://al2100.twoja-subdomena.workers.dev`)

### 6. Pierwsze uruchomienie

1. Otwórz adres Workers w Safari
2. Zaloguj się przez GitHub lub Google (po skonfigurowaniu OAuth)
3. Wejdź w **Ustawienia → Klucze AI**
4. Dodaj przynajmniej jeden klucz (Gemini / Groq / Mistral / OpenRouter)
5. Gotowe — możesz pisać

### 7. Aktualizacje z iPhone’a

1. Edytuj plik `AL2100.ax` bezpośrednio w GitHubie (Edit)
2. Commit
3. Actions automatycznie zbuduje i wdroży nową wersję

## Ważne sekrety (nigdy nie wklejaj do kodu)

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `AL_MASTER_ENCRYPTION_KEY` (ustaw w Cloudflare Workers → Settings → Variables → Secrets)

## Lokalne uruchomienie (gdy będziesz miał komputer)

```bash
npm install
node axc.js build AL2100.ax
cd dist
npx wrangler dev
