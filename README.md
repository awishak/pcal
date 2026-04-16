# PCAL League

React app for tracking the PCAL (Pacific Coptic Athletic League) basketball stats and registrations.

## Local development

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Deploy to Vercel

### Option A: Through GitHub (recommended, easiest to update)

1. Create a GitHub account if you don't have one (github.com)
2. Install GitHub Desktop (desktop.github.com) — it's the easiest way to push code
3. Open GitHub Desktop → File → New Repository → pick this folder → "Publish repository"
4. Go to vercel.com, sign in with GitHub
5. Click "Add New Project" → pick the pcal-app repo → Deploy
6. Vercel auto-detects Vite and builds it. Default settings work.
7. After deploy, in project settings → Domains, add `pcaleague.vercel.app` (or whatever you want)

### Option B: Direct upload (simpler, but harder to update)

1. Run `npm install && npm run build` locally to produce the `dist/` folder
2. Go to vercel.com and create a free account
3. Click "Add New Project" → upload the `dist/` folder

After either option, you can manage the project at vercel.com.

## Project structure

- `src/App.jsx` — The entire app (one big file, ~18k lines). All logic, data, and UI lives here.
- `src/main.jsx` — React entry point that mounts App into the page.
- `index.html` — HTML shell, loads Tailwind via CDN.
- `vite.config.js` — Vite build config.
- `package.json` — Dependencies.

## Updating the app

If deployed via GitHub (Option A): Any edits to `src/App.jsx` followed by a commit + push will auto-redeploy to Vercel within a minute.

If deployed via direct upload (Option B): Rebuild with `npm run build` and upload the new `dist/` folder.
