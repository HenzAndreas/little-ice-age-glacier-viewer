# Deployment

How to put the viewer online. Written 2026-10-19.

## What has to be hosted

| part | size | where it lives |
| --- | --- | --- |
| Page code: `index.html`, `style.css`, `site-config.js`, `js/`, `data/`, `favicon/` | ~6 MB | GitHub repository, served by GitHub Pages |
| Processing scripts: `processing-files/`, `scripts/`, `tests/` | small | GitHub repository (not served on the page) |
| Three PMTiles archives in `local-data/` | ~46 MB | GitHub Release assets, copied into the Pages site at deploy time |
| Source data in `original-data/` | ~1.3 GB | stays local; publish on Zenodo (or wherever the paper's data is archived), not on GitHub |
| Basemap, imagery, terrain, libraries | — | already online: Protomaps, Esri, Mapterhorn, unpkg/jsdelivr |

The site is static: no server code and no database. The browser only needs
HTTP Range requests on the `.pmtiles` files.

## Recommended setup: everything on GitHub

1. The **repository** holds the code and scripts. `local-data/` and
   `original-data/` are in `.gitignore`, so no data goes into Git history.
2. A **GitHub Release** (tag `data-v1`) holds the three `.pmtiles` files as
   assets. Each file is well under the 2 GB asset limit.
3. **GitHub Pages**, deployed by `.github/workflows/pages.yml`, first runs the
   JS tests (a failure stops the deploy), then copies the page
   code and downloads the release assets into `tiles/`. The code already loads
   `tiles/...`, the same path `scripts/serve.py` uses locally, so no URL
   changes. The archives are served from the same origin as the page, so CORS
   is not an issue.

Rebuilding the data means uploading the new files to a new release (`data-v2`),
bumping `DATA_RELEASE` in the workflow and pushing.

**Limits.** A Pages site may be up to 1 GB, with a soft bandwidth limit of
100 GB per month. At ~46 MB of data, and since a visitor only downloads the
tiles they look at, this is plenty for a research viewer.

**Fallback.** If the data grows (for example, Cloud-Optimized GeoTIFFs for
download), or Pages traffic becomes too high, move the archives to
**Cloudflare R2** (10 GB free, no egress fees). R2 needs a CORS rule
that allows `GET`/`HEAD` with the `Range` header and exposes `Content-Range`,
`Content-Length`, `Accept-Ranges` and `ETag`. Then point `tilesBase`
in `site-config.js` at the bucket: all three archive paths (the manifest's
`url`, the surface patch and the outlines) are resolved under it.

## Steps

### 1. Repository

```bash
cd ~/little-ice-age-glacier-viewer
git init -b main
git status        # check: no original-data/, no local-data/, no *.pmtiles
git add .
git commit -m "Little Ice Age glacier viewer"
gh repo create little-ice-age-glacier-viewer --public --source . --push
```

Use the GitHub web interface instead of `gh` if you prefer: create an empty
repository, then `git remote add origin ...` and `git push -u origin main`.

### 2. Data release

```bash
gh release create data-v1 local-data/*.pmtiles \
  --title "Web data v1" \
  --notes "PMTiles built from Henz et al. (2025) with processing-files/build_lia_*.py"
```

### 3. Pages

In the repository: **Settings → Pages → Build and deployment → Source:
GitHub Actions**. Then rerun the workflow (**Actions → Deploy to GitHub Pages
→ Run workflow**). The site appears at
`https://<user>.github.io/little-ice-age-glacier-viewer/`.

### 4. Basemap key

The Protomaps API key in `js/config.js` (`basemapUrl`) only works on the
domains listed for it. Log in at <https://protomaps.com/account>, add
`<user>.github.io` (and any custom domain) to the key's allowed origins, or
create a new key for the public site and put it in `config.js`.

### 5. Check the live site

```bash
curl -sI -H "Range: bytes=0-15" \
  https://<user>.github.io/little-ice-age-glacier-viewer/tiles/Alps-wide_LIA_outlines.pmtiles
```

Expect `HTTP/2 206` and a `content-range` header. Then open the page and
check the 3D view, the switch, the tour, an outline popup and the browser
console.

### Optional: custom domain

Add a `CNAME` record at your DNS provider pointing to `<user>.github.io`, then
enter the domain under **Settings → Pages → Custom domain**, and add it to the
Protomaps key.

## Publishing checklist

Before the link goes public:

- [x] **Data licence.** CC BY 4.0 for the paper, the Zenodo data and the
      derived web layers. Stated in `README.md` and in the page's Credits
      section. The MIT `LICENSE` covers only the code.
- [x] **Credits.** A collapsible "Credits" section below "Map options" credits
      the reconstruction, Luis Q. Gentner's GLACE viewer, Claude (Anthropic)
      for help adapting the code, and the map data providers. The GLACE
      attribution is also in `README.md`.
- [x] **Citation.** The Cryosphere paper (doi:10.5194/tc-19-5913-2025) in
      `index.html`, the outline popup (`js/overlays.js`), the archive
      attributions (rebuilt 2026-10-20) and `README.md`.
- [x] **Raw data link.** Zenodo, doi:10.5281/zenodo.17608701, linked under
      the paper link, in the Credits and in the README.
- [x] **Leftover GLACE wording.** The product, quantity and compositing text
      is gone; the panel shows "Ice thickness opacity" and the scale.
- [x] **Tour text.** New intro sentence in `js/tour.js` (`STEPS`).
- [x] **Third-party terms.** The Credits section states that this is a public,
      non-commercial research site, and credits Esri, OpenStreetMap,
      Protomaps, Mapterhorn and MapLibre. The basemap key still needs the
      live domain (step 4).
- [x] **Tests.** The viewer tests cover the LIA page (`npm test`, 72 tests),
      and the Pages workflow runs them before each deploy.
- [ ] **Browsers.** Try the live page in Chrome, Firefox, Safari and on a
      phone (the panel starts collapsed on narrow screens).
- [x] **Page metadata.** Favicons from `favicon/`, a `<meta name="description">`
      and Open Graph title and description.
- [ ] **Social preview image.** Add `og:image` once the live URL is known
      (it should be an absolute URL, 1200×630 px works best).
- [x] **GLACE remnants removed:** `js/store.js`, `js/cog-rgb.js`, the STAC
      path in `js/rasters.js`, their tests and fixtures, and the `lerc`
      import-map entry.
