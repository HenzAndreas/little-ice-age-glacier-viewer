# Deployment

How to put the viewer online. Written 2026-10-19.

## What has to be hosted

| part | size | where it lives |
| --- | --- | --- |
| Page code: `index.html`, `style.css`, `site-config.js`, `js/`, `data/` | ~6 MB | GitHub repository, served by GitHub Pages |
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
3. **GitHub Pages**, deployed by `.github/workflows/pages.yml`, copies the page
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
in `site-config.js`, the `url` in `data/lia-layers.json`, and
`LIA_SURFACE_PATCH_URL`/`LIA_OUTLINES_URL` in `js/config.js` at the bucket.

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

- [ ] **Data licence.** Choose one for the derived web products (CC BY 4.0
      would match most journal data). State it in `README.md` and in the page
      credits. The MIT `LICENSE` covers only the code.
- [ ] **Credits.** Keep the attribution to Luis Q. Gentner's GLACE viewer in
      `README.md`, and add it to the page (for example, under the paper link or
      in the attribution control).
- [ ] **Citation.** Update the Henz et al. (2025) reference and DOI from the
      EGUsphere preprint to the final paper once it is published (in
      `index.html`, the outline popup in `js/overlays.js`, the layer
      attributions, and `README.md`).
- [ ] **Raw data link.** Link the archived source data (Zenodo or similar) from
      the page and the README.
- [ ] **Leftover GLACE wording.** Replace "Product: LIA thickness" and
      "LIA thickness composite / Local resolution weighted median" in the
      panel (from `js/rasters.js`).
- [ ] **Tour text.** Read the tour wording in `js/tour.js` (`STEPS`),
      especially the intro sentence about the LIA maximum and the model.
- [ ] **Third-party terms.** Check the attribution and use terms for Esri
      World Imagery, Protomaps and Mapterhorn for a public, non-commercial
      site.
- [ ] **Tests.** Update the stale viewer tests (`tests/viewer*.test.js`) and
      run `pixi run --locked test`. Adding a test job to the workflow would
      keep it green.
- [ ] **Browsers.** Try the live page in Chrome, Firefox, Safari and on a
      phone (the panel starts collapsed on narrow screens).
- [ ] **Page metadata.** Add a favicon, a `<meta name="description">` and
      a social preview image (`og:image`) for shared links.
- [ ] **Remove the GLACE remnants** that the page still imports but does not use
      (`js/store.js`, `js/cog-rgb.js` and the GLACE STAC path in `js/rasters.js`),
      once the viewer tests cover the LIA path.
