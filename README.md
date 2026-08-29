# TenShadows

Shadow-aware pedestrian routing. 

`TenShadows` finds walking routes optimised for shade rather than for distance, by attaching to every street segment a number between 0 and 1 describing how much of that segment currently lies in the shadow of a building, and then letting you trade distance against sun exposure.

The project is named after the **Ten Shadows Technique** from the *Jujutsu Kaisen* anime/manga, used by Megumi Fushiguro (known as "Mr. Potential Man" for having the potential to match Satoru Gojo but never doing anything meaningful), who manipulates and travels through shadows.


## Why

Direct sunlight and high heat make walking unpleasant, but I love walking. Other map applications optimise for the shortest or fastest path and will happily send you down a completely unshaded street (well, that is still helpful most of the time!). `TenShadows` re-weights the pedestrian road network using the sun's position and 3D building geometry, so that a slightly longer route through shade beats a short one in full sun.

How much longer is up to you. A shade-preference slider `w` sets the exchange rate: the router will accept a route up to `(1 + w)` times as long if it stays fully in shade. At `w = 0` you get an ordinary shortest path.


## The maths

All of it is derived from scratch in **[docs/TenShadows.pdf](docs/TenShadows.pdf)** - solar position, the shadow calculation per building, the shadow fraction of a street segment, the edge cost function, and a proof that straight-line distance remains an admissible A\* heuristic under it.

That document is the specification. Where the code and the document disagree (in case of logical bugs), the document is right and the code is wrong.

**Read it before reading the code.** The code does not re-explain the math. Symbols keep the names the document gives them, and the constants they depend on are documented in the document and in `shared/constants.json` rather than at each use site.


## Architecture

Static and zerocost, designed to run entirely on GitHub Pages.

**Python pipeline (`pipeline/`)** downloads the walking network and building footprints from OpenStreetMap, resolves building heights from sparse OSM tags, computes edge lengths in a projected metric CRS, and exports the graph and building geometry as `EPSG:4326` artifacts.

**Svelte client (`web/`)** loads those artifacts, computes the sun's position for the chosen time with SunCalc, determines each edge's shadow fraction live in a Web Worker by ray-casting against the building footprints, and runs A\* in the browser.

Shadow fractions are computed in the browser rather than baked into the artifacts, because a baked fraction is only valid for the one instant it was computed for. 


## Status

Early. The data pipeline is under construction and there is no client yet.

```
pipeline/    Python data engine
web/         Svelte client (not yet started)
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

On WSL with the repository under `/mnt/c`, put the environment on the Linux filesystem instead - Windows drives are exposed over a 9p mount, and importing GeoPandas and OSMnx touches thousands of small files. Measured here, identical packages either way: 27 s per import from `/mnt/c` against 0.9 s from ext4, which is a cost every `pytest` run pays before a single assertion.

```sh
export UV_PROJECT_ENVIRONMENT="$HOME/.venvs/tenshadows"    # add to ~/.bashrc
```

## Development

`ruff` covers linting, import sorting and formatting, so there is no separate isort or black to install. Import order is rule `I` in the existing lint selection.

```sh
uv run ruff check .          # lint, including import order
uv run ruff check --fix .    # apply the fixable findings
uv run ruff format .         # format
uv run pytest
```

`fixtures/reference/` records what the pipeline answers for a fixed set of inputs. The browser implements the same maths, so its test suite asserts against that file and the two cannot drift apart unnoticed. The inputs are pinned rather than sampled: two implementations can only be compared if both are asked the same question, and a fixed set of questions means any diff in the file is a real change in behaviour. Regenerate after changing anything it covers, and read the diff:

```sh
uv run python -m tenshadows.reference
```


## Adding a city

Drop a TOML file into `pipeline/cities/`. No code changes, anywhere.

```toml
# pipeline/cities/porto.toml
display_name = "Porto"
osm_query = "Porto, Portugal"

[center]
lon = -8.6110
lat = 41.1496
```

The filename stem is the city key, so this becomes `tenshadows build --city porto` and exports to `web/static/data/porto/`. The UTM zone is derived from the centre; state it as `[crs] expected_utm_epsg` if you want it asserted rather than inferred.

Bear in mind that the type-based building heights in `shared/constants.json` are calibrated for European building stock. Somewhere with a very different housing profile may want those numbers changed.


## Known limitations

These are deliberate simplifications, documented in Section 7 of the specification, not bugs:

- The ground is assumed flat. On Tbilisi's hills this is materially wrong.
- Only buildings cast shadows. Trees are ignored, and on residential streets trees are very often the dominant source of shade.
- Buildings are opaque flat-roofed prisms of a single height.
- Only direct sunlight is modelled.
- **Building heights come from OSM tags that are sparse.** Only 0.23% of Tbilisi's buildings and 0.14% of Saarbrücken's carry an explicit `height` tag; `building:levels` covers roughly 15% and 19%. The large majority fall back to a type-based default. This is the dominant error source in the whole system, and the client reports it rather than hiding it.
