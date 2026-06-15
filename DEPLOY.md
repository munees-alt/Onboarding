# Deploying Cadence to Vercel

The app is a standard Next.js 16 app in this folder. Supabase is already live.

## 1. Push to GitHub
This folder (`cadence/`) is the repo root. From here:
```bash
git remote add origin https://github.com/<you>/cadence.git
git push -u origin main
```

## 2. Import in Vercel
- vercel.com → Add New → Project → import the repo.
- **Framework:** Next.js (auto-detected). **Root Directory:** `.` (the repo root is this folder).
- Build/Output: defaults are correct.

## 3. Environment variables (Vercel → Project → Settings → Environment Variables)
Copy each from your local `.env.local`:

| Key | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | secret |
| `CADENCE_ENCRYPTION_KEY` | **must be the same value** as local — it decrypts the AI/Zoho keys already stored in the DB |
| `NEXT_PUBLIC_APP_URL` | set to your Vercel URL, e.g. `https://cadence.vercel.app` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | same |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_ACCOUNTS_DOMAIN` | when you add Zoho |
| `DATABASE_URL` / `DIRECT_URL` | only used by local migration scripts; optional on Vercel |

> `CADENCE_ENCRYPTION_KEY` must match local exactly, or saved provider keys won't decrypt.

## 4. After first deploy — update redirect URIs to the prod domain
- **Supabase → Authentication → URL Configuration:** add `https://<your-domain>` to Site URL + Redirect URLs (`https://<your-domain>/auth/callback`).
- **Google Cloud → OAuth client → Authorized redirect URIs:** add `https://<your-domain>/api/connect/google/callback`.
- **Zoho console → your Server-based app:** add `https://<your-domain>/api/connect/zoho/callback`.
- Set `NEXT_PUBLIC_APP_URL` to the prod domain (step 3) and redeploy.

## 5. Team onboarding (one-time)
- Supabase → Authentication → keep "Confirm email" OFF for instant signup (or configure email).
- In the app's **Org Chart**, set each teammate's **work email** → they sign up with that email → their role is applied automatically.
- One teammate clicks **Settings → Connect Google** to enable Drive/Gmail.

## Migrations / seed (already applied to your Supabase)
Schema + seed are live. To re-run against a fresh DB:
```bash
node --env-file=.env.local scripts/db-push.mjs   # schema
node --env-file=.env.local scripts/seed.mjs      # org, COA templates, org chart
node --env-file=.env.local scripts/seed-demo.mjs # Gulf Retail demo run
```
