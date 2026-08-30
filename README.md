# DraCool

Shadow-aware pedestrian routing. 

`DraCool` finds walking routes optimised for shade rather than for distance, by attaching to every street segment a number between 0 and 1 describing how much of that segment currently lies in the shadow of a building, and then letting you trade distance against sun exposure.


## Why

Direct sunlight and high heat make walking unpleasant, but I love walking. Other map applications optimise for the shortest or fastest path and will happily send you down a completely unshaded street (well, that is still helpful most of the time!). `DraCool` re-weights the pedestrian road network using the sun's position and 3D building geometry, so that a slightly longer route through shade beats a short one in full sun.

How much longer is up to you. A shade-preference slider `w` sets the exchange rate: the router will accept a route up to `(1 + w)` times as long if it stays fully in shade. At `w = 0` you get an ordinary shortest path.


## The maths

All of it is derived from scratch in **[docs/DraCool.pdf](docs/DraCool.pdf)** - solar position, the shadow calculation per building, the shadow fraction of a street segment, the edge cost function, and a proof that straight-line distance remains an admissible A\* heuristic under it.

That document is the specification. Where the code and the document disagree (in case of logical bugs), the document is right and the code is wrong.

**Read it before reading the code.** The code does not re-explain the math. Symbols keep the names the document gives them, and the constants they depend on are documented in the document and in `shared/constants.json` rather than at each use site.


## Architecture

Static and zerocost, designed to run entirely on GitHub Pages.

**Python pipeline (`pipeline/`)** downloads the walking network and building footprints from OpenStreetMap, resolves building heights from sparse OSM tags, computes edge lengths in a projected metric CRS, and exports the graph and building geometry as `EPSG:4326` artifacts.

**Svelte client (`web/`)** loads those artifacts, computes the sun's position for the chosen time with SunCalc, determines each edge's shadow fraction live in a Web Worker by ray-casting against the building footprints, and runs A\* in the browser. **THE ENTIRE FRONTEND IS WRITTEN VIA CLAUDE SONNET 5 UNDER MY SUPERVISION.**

Shadow fractions are computed in the browser rather than baked into the artifacts, because a baked fraction is only valid for the one instant it was computed for. 


## Status

The pipeline and the client are both complete. Deployment is what is left.

```
pipeline/    Python data engine
web/         Svelte client
shared/      constants used by both, defined once
docs/        the specification
```

## Getting started

The pipeline uses [uv](https://docs.astral.sh/uv/). It provisions the interpreter, the virtual environment and the dependencies in one step, so there is nothing to activate and no Python to install first.

```sh
cd pipeline
uv sync
uv run pytest
```

## The client

The Svelte client lives in `web/` and reads whatever the pipeline has put in `web/static/data/`. 

```sh
cd pipeline && uv run dracool mini
cd ../web && npm install && npm run dev
```

The date and time control drive the sun; the panel reports the solar altitude and azimuth, the mean shadow fraction over the network, and how long the pass took. Time is read in the city's own zone, which `meta.json` carries as an IANA name. Below the horizon `sigma` is 1 everywhere by convention and the panel says so, because that number is not a shade measurement.

The network is coloured by `sigma`: one blue ramp, light for sun and dark for shade, with the legend beside it. Click the map twice to set a start and a finish; a third click starts over. The `w` slider is the exchange rate, and moving it re-routes without recomputing shade, because `sigma` depends on the sun and not on `w`. The panel reports the distance walked and how much of it is in sun, which is the number that means something whatever `w` is set to.

The city switcher is built from `web/static/data/cities.json`, which the pipeline writes from the artifacts.

Deployment is to a GitHub Pages subpath. Serve the built site from a subdirectory instead:

```sh
npm run build
mkdir -p /tmp/pages/DraCool && cp -r build/* /tmp/pages/DraCool/
python3 -m http.server 8000 --directory /tmp/pages   # open /DraCool/
```

## Development

`ruff` covers linting, import sorting and formatting, so there is no separate isort or black to install. Import order is rule `I` in the existing lint selection.

```sh
uv run ruff check .          # lint, including import order
uv run ruff check --fix .    # apply the fixable findings
uv run ruff format .         # format
uv run pytest
```

Frontend tests:

```sh
cd web && npm test
```

`suncalc` is pinned to the 1.x line on purpose: `suncalc-py` is a port of it, and they agree to 5e-10 degrees. Version 2 rewrote the series and disagrees by up to a degree of azimuth, which would rotate every shadow in the city.

Examples of some commands:

```sh
uv run dracool cities                # list the defined cities
uv run dracool build --city tbilisi  # fetch one city, write its artifacts
uv run dracool build --all           # every defined city
uv run dracool fixture               # rebuild the offline test extract from OSM
uv run dracool reference             # regenerate the cross-language values
```

`build` writes `meta.json`, `buildings.geojson` and `graph.json` into `web/static/data/<city>/`. Those are generated, not committed: the whole of Tbilisi is about 7 MB gzipped, and it is cheaper to rebuild than to carry in the history.

`build` and `fixture` are the only commands that touch the network. Overpass responses are cached under `pipeline/.cache/`, so re-running a city does not re-download it. The test suite never hits the network: it runs against the committed extract in `pipeline/fixtures/mini/`.

`fixtures/reference/` records what the pipeline answers for a fixed set of inputs. The browser implements the same maths, so its test suite asserts against that file and the two cannot drift apart unnoticed. The inputs are pinned rather than sampled: two implementations can only be compared if both are asked the same question, and a fixed set of questions means any diff in the file is a real change in behaviour. Regenerate after changing anything it covers, and read the diff:

```sh
uv run python -m dracool.reference
```


## Adding a city

Drop a TOML file into `pipeline/cities/`. No code changes, anywhere.

```toml
# pipeline/cities/porto.toml
display_name = "Porto"
osm_query = "Porto, Portugal"
timezone = "Europe/Lisbon"

[center]
lon = -8.6110
lat = 41.1496
```

The filename stem is the city key, so this becomes `dracool build --city porto` and exports to `web/static/data/porto/`. The UTM zone is derived from the centre; state it as `[crs] expected_utm_epsg` if you want it asserted rather than inferred.

`timezone` is an IANA name and is required. The client's clock reads local time and the solar oracle takes UTC, so the conversion needs the real zone with its DST; an offset guessed from the longitude would be an hour wrong for half the year.

Bear in mind that the type-based building heights in `shared/constants.json` are calibrated for European building stock. Somewhere with a very different housing profile may want those numbers changed.


## License

The code is **MIT** ([LICENSE](LICENSE)). Do whatever you like with it - fork it, change it, ship it commercially - and it comes with no warranty and no liability on me.

The map data is **not** mine to license that way. It comes from OpenStreetMap and stays under the Open Database Licence:

> Map data © OpenStreetMap contributors, available under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).

That covers the test extract in `pipeline/fixtures/mini/` and every city artifact the pipeline builds, because reshaping OSM data produces a derived database. In practice it means anything you deploy publicly has to credit OpenStreetMap on screen, and a modified copy of the *data* has to stay ODbL. Your own code is unaffected. See [LICENSE-DATA](LICENSE-DATA).


## Known limitations

These are deliberate simplifications, documented in Section 7 of the specification, not bugs:

- The ground is assumed flat. On Tbilisi's hills this is materially wrong.
- Only buildings cast shadows. Trees are ignored, and on residential streets trees are very often the dominant source of shade.
- Buildings are opaque flat-roofed prisms of a single height.
- Only direct sunlight is modelled.
- **Building heights come from OSM tags that are sparse.** A fraction of a percent of buildings carry an explicit `height` tag and only a minority carry `building:levels`, so most heights are a type-based default. This is the dominant error source in the whole system, and the client reports it rather than hiding it. Figures are not quoted here because they drift as the map is edited and depend strongly on the boundary measured - over Saarbrücken, `building:levels` covers 29% within the city limits but 13% across the surrounding bounding box. Run `dracool build --city <key>` for your own city's numbers.
