# Visitor statistics (GoatCounter)

How visits and clicks on this viewer are counted, and how to reuse the setup on
other websites. Written 2026-10-26.

## Account

- Service: [GoatCounter](https://www.goatcounter.com), free for non-commercial use.
- Account: **`henzandreas`** (the first site created; one account can hold
  several sites)
- Site code for this viewer: **`henzandreas-lia-viewer`**, so the dashboard
  name makes clear that the counts belong to the LIA viewer
- Dashboard: <https://henzandreas-lia-viewer.goatcounter.com>
- Count endpoint: `https://henzandreas-lia-viewer.goatcounter.com/count`

The site code appears in the page source anyway, so it is not a secret. The
login is the account's e-mail and password; neither is stored here.

## Why GoatCounter

GitHub Pages keeps no visitor statistics. The repository's *Insights → Traffic*
counts visits to the repository, not to the website. The alternatives
considered were:

| Service | Cost | Click events | Notes |
|---|---|---|---|
| **GoatCounter** (chosen) | Free, non-commercial | Yes | No cookies, so no consent banner; simple; open source, can be self-hosted |
| Umami Cloud | Free tier | Yes | No cookies; more setup |
| Plausible | ~€9/month | Yes | No cookies, EU-hosted |
| Cloudflare Web Analytics | Free | No | Page views only |
| Google Analytics | Free | Yes | Sets cookies, so it needs a consent banner (GDPR / Swiss data protection law) |

Ad blockers block 10–30% of such scripts, so treat the numbers as lower
bounds. GoatCounter ignores `localhost`, so local testing is never counted.

## What was done in this viewer

1. **Page views:** the script tag GoatCounter gives you, at the end of
   `<body>` in `index.html`:

   ```html
   <script data-goatcounter="https://henzandreas-lia-viewer.goatcounter.com/count"
           async src="https://gc.zgo.at/count.js"></script>
   ```

2. **Click events:** `js/analytics.js` puts one `click` and one `change`
   listener on the whole document. It maps the IDs and classes of the controls
   to event names and calls
   `window.goatcounter.count({ path, title, event: true })`. The control code
   itself is unchanged. When the script is blocked or has not loaded yet,
   nothing is sent and nothing breaks. `js/app.js` calls `initAnalytics()` at
   startup.
3. **3D mode:** `setThreeD()` in `js/map.js` calls `noteThreeD(on, via)`,
   so 3D is counted however it was switched on. On the first
   `visibilitychange` to hidden (or `pagehide`) the page reports whether it was
   left in 3D, and how long 3D was used. GoatCounter sends these with
   `sendBeacon`, which survives the tab being closed. Events from before the
   GoatCounter script has loaded are queued and sent once it is there.
4. **Popups:** `js/overlays.js` calls `countEvent("popup/lia-outline")` when a
   glacier popup opens. It does not record which glacier.
5. **Credits:** the credits section says that visits and clicks are counted
   anonymously with GoatCounter, without cookies or personal data.
6. **Test:** `tests/analytics.test.js` checks the event names, and that the page
   works without the GoatCounter script.

Events that appear in the dashboard (events are listed among the paths):

| Event | When it is counted |
|---|---|
| `period/lia`, `period/today` | Glacier-state switch |
| `tour/open`, `tour/skip`, `tour/done` | "?" button, skipping or finishing the tour (the automatic first-visit tour is not counted as `tour/open`) |
| `outlines/on\|off`, `hillshade/on\|off`, `labels/on\|off` | Checkboxes |
| `basemap/imagery`, `basemap/relief` | Basemap choice |
| `3d/on/<via>`, `3d/off/<via>` | 3D switched on or off; `<via>` is `button`, `tour` (the "Show me Aletsch in 3D" flight) or `url` (a shared link or reload that opens tilted). Replaced `map/3d-toggle` on 2026-10-29, which only counted the button |
| `leave/3d`, `leave/2d` | Once per page load, when the page is first hidden (tab closed or switched, phone locked): the mode the reader left in |
| `3d/time/under-1min`, `1-5min`, `5-15min`, `over-15min` | Sent with `leave/…` if 3D was used: total time spent in 3D, binned |
| `slider/opacity`, `slider/hillshade-strength` | Once per drag, when released |
| `section/map-options`, `section/credits`, `section/inventories` | When a section is opened |
| `panel/open`, `panel/close` | Panel toggle (mostly phones) |
| `popup/lia-outline`, `popup/inventory` | A map popup opens |
| `link/<host>/<path>` | Clicks on links leaving the page (paper, data, GLACE viewer) |

## Reusing it on another website

One account can count several sites. In the GoatCounter dashboard, go to
*Settings → Sites* and add a site with its own code following the same pattern (e.g. `henzandreas-<site-name>`), so
each site gets separate statistics. Then:

1. **Page views only:** paste the script tag above with the new code. That is
   all a simple site needs.
2. **Clicks without JavaScript:** GoatCounter counts clicks on any element with
   a `data-goatcounter-click` attribute that exists when the page loads:

   ```html
   <a href="paper.pdf" data-goatcounter-click="download-paper">PDF</a>
   ```

3. **Clicks on elements created by JavaScript** (as in this viewer): copy
   `js/analytics.js`, replace the `BUTTONS` / `INPUTS` tables with the new
   site's IDs, and call `initAnalytics()` at startup. To count anything else
   (a popup, a finished download), call `countEvent("name")`.
4. Add a privacy line to the site's credits or footer, as here.
5. Check from a browser without an ad blocker on the live site, not on
   localhost. The first hits show in the dashboard within a minute.

## Credits

The viewer is adapted from Luis Q. Gentner's
[GLACE viewer](https://lqgentner.github.io/glace-viewer); see `README.md` for
the research-data citation. The GoatCounter setup was added with the help of
Claude (Anthropic) in Claude Code on 2026-10-26.
