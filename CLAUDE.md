# Working on this repo

Owner: Matthew De Castro Silva. GitHub account/organisation: `DeCastroSilvaRecruiting`.

## Access

- Matthew's GitHub account is meant to be connected through a Claude GitHub app. Never ask him for a password or personal access token.
- This repo is `DeCastroSilvaRecruiting/Course-Guide-Creator` — access level needed is `push` (Claude commits directly to `main`; this is a solo static-site project, no PR flow yet). Don't touch any other repo without being told to.
- If a session's tools don't include an `add_repo`-style GitHub attach tool, or a push is refused, say exactly why — don't guess or retry silently. (This has happened at least once: a Cowork cloud-sandbox session had no GitHub MCP connector and no `add_repo` tool at all, and a raw `git push` over HTTPS with a personal access token was blocked by that sandbox's own session-level repo allowlist, independent of GitHub's permissions. If that recurs, the fix is on Matthew's side — checking GitHub → Settings → Applications → Claude and claude.ai → Settings → Connectors — not something to work around from inside the session.)
- Don't probe whether the repo exists with unauthenticated `curl` first — it's not public visibility that's in question, it's write access.

## How to work

- Read this file and the README before changing anything.
- Make changes, run `node --check` on every touched `.js` file, and smoke-test in a browser (Playwright is available) before committing — this is a static site with no build step and no server, so "run the tests" means opening the pages and exercising the flow, not a test runner.
- Commit small, clear changes with conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`). Push straight to `main` unless told otherwise.
- Never commit secrets, tokens, `.env` files, or personal data. This app's own API keys (Mapbox, OpenTopography) are entered by the end user at runtime into a Settings panel and kept in `localStorage` only — never hardcode a real key into the source.
- Before starting work, pull the latest `main` first — other tools/sessions may also push here.

## Deployment

- The site deploys via GitHub Pages from the `main` branch, root folder. Once enabled (Settings → Pages → Deploy from a branch → `main` / root), it's live at `https://decastrosilvarecruiting.github.io/Course-Guide-Creator/` a minute or two after a push — there's no separate deploy step or CI job to trigger.
- After each deploy, tell Matthew what changed, the commit hash, and the live link. Remind him to hard-refresh (and that the installed PWA's service worker caches the app shell, so a stale view after a deploy is more likely than on a plain page).

## Ask first before

- Deleting files, branches, or the repo; force-pushing; rewriting history; changing repo settings, GitHub Pages config, or permissions.

## Project-specific context

See `README.md` for the app's own architecture/data-source notes. The project's running build log — what's been added, researched, and why — lives in the attached claude.ai Project's docs (`github-app-status.md`, `repl-status.md`), not in this repo.
