# Maple Plan — Vercel deployment

Static single-page app. No build step.

## Three ways to deploy

### 1. Vercel CLI (fastest — 60 seconds, recommended)

From this directory (`maple-plan-deploy/`):

```bash
npx vercel --prod
```

First run will prompt you to log in (browser opens), pick a scope/team, accept defaults for the project. Subsequent runs deploy in place. You'll get a `*.vercel.app` URL printed at the end.

### 2. Vercel dashboard drag-and-drop (no CLI install)

1. Open https://vercel.com/new
2. Sign in (GitHub / GitLab / email)
3. Drag this entire `maple-plan-deploy` folder into the upload area
4. Click **Deploy**

### 3. GitHub-connected continuous deploy

```bash
cd maple-plan-deploy
git init && git add . && git commit -m "Initial Maple Plan prototype"
gh repo create maple-plan --private --source=. --push    # needs GitHub CLI
```

Then on https://vercel.com/new, import the new GitHub repo. Every push to `main` redeploys automatically.

## Verify locally before deploying

```bash
npm run serve         # starts a local server on port 3000
# or
python3 -m http.server 8000
```

Open http://localhost:8000 (or :3000) and confirm the app renders.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app — React + Tailwind + Recharts via CDN |
| `vercel.json` | Caching, security headers |
| `package.json` | npm scripts for `deploy`, `preview`, `serve` |

## Notes

- Loads React 18, Recharts 2, Tailwind, Babel-standalone from unpkg.com CDN. First load needs internet.
- All user inputs persist to `localStorage` only — no backend, no PII leaves the browser.
- Educational disclaimer banner is rendered on every page.
