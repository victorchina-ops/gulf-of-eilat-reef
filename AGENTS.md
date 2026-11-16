# Repository Workflow & Auto-Updating Version History

This repository automatically embeds its release counter (`v1`, `v2`, ..., `vN`), full Git commit timeline, and structured `CHANGELOG.md` notes directly into the web app and single-file standalone HTML build at bundle time.

## How Auto-Sync Works
- **`vite.config.js` (`reefVersionPlugin`)** exposes the virtual module `virtual:reef-version` at dev/build time by running `git log --reverse` and parsing `CHANGELOG.md`.
- **`.github/workflows/deploy-pages.yml`** uses `fetch-depth: 0` on `actions/checkout@v4` so GitHub Actions sees the complete `V1..VN` commit history when building GitHub Pages.
- **`src/ui/welcomeScreen.js` & `src/ui/hud.js`** consume `virtual:reef-version` directly - version badges (`vN`), comparison labels (`V1 Prototype vs. VN`), and commit/changelog lists update automatically without hardcoded version edits.

## Checklist for Future Updates
1. Update code and prepend a concise release section or bullet to `CHANGELOG.md`.
2. If rendering, shaders, or UI visuals change materially, refresh `src/assets/evolution/latest-panorama-hud.jpg` and `src/assets/evolution/latest-reef-view.jpg` (`1152x720` JPEGs; keep `V1` captures untouched). The **Live Canvas** comparison tab always captures the current running WebGL frame automatically.
3. Run verification tests + `npm run build`.
4. **Commit first** (`git commit`) so `HEAD` increments to the next `VN` version number.
5. Run `npm run build:standalone` **after committing** if regenerating `gulf-of-eilat-reef-standalone.html` so the standalone bundle embeds the new `VN`.
6. Push `git push origin main` - GitHub Actions will build and deploy `VN` to GitHub Pages automatically.
