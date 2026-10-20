# Little Ice Age glaciers of the European Alps

An interactive 3D map of the glaciers of the European Alps at their maximum
stage during the Little Ice Age (1260 to 1860 CE), reconstructed with a 3D
glacier model. It shows the reconstructed ice thickness and surface, the
glacier outlines with their attributes, and a switch to compare them with
today's landscape.

## Reference

Henz, A., Reinthaler, J., Nussbaumer, S. U., Leger, T. P. M., Kamleitner, S.,
Jouvet, G., & Vieli, A. (2025). Alps-wide high-resolution 3D modelling
reconstruction of glacier geometry and climatic conditions for the Little Ice
Age. *The Cryosphere*, 19(11), 5913–5937.
[doi:10.5194/tc-19-5913-2025](https://doi.org/10.5194/tc-19-5913-2025)

The data is on Zenodo:
[doi:10.5281/zenodo.17608701](https://doi.org/10.5281/zenodo.17608701).
The LIA glacier outlines are from Reinthaler and Paul (2025),
[doi:10.5194/tc-19-753-2025](https://doi.org/10.5194/tc-19-753-2025).

## Licences

- **Data and map layers:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  Please cite Henz et al. (2025).
- **Code:** MIT, see [LICENSE](LICENSE).
- Basemap imagery, labels and terrain belong to their providers (Esri,
  OpenStreetMap/Protomaps, Mapterhorn) and are credited on the map.

## Credits

The viewer is adapted from Luis Q. Gentner's GLACE viewer. The code was
adapted with the help of Claude (Anthropic). It is built with
[MapLibre GL JS](https://maplibre.org/) and [PMTiles](https://protomaps.com/docs/pmtiles).

## Running it locally

The page is plain HTML, CSS and JavaScript with no build step. It needs a
server that answers HTTP range requests:

```bash
python scripts/serve.py --tiles-dir local-data
```

Then open `http://localhost:8000/`. The map archives are not in this
repository. They are attached to the repository's `data-v1` release; put them
in `local-data/`. Run the tests with `npm ci && npm test`.
