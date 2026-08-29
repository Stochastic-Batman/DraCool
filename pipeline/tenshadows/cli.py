from __future__ import annotations

import json

import typer

from tenshadows.cities import City, all_cities, get_city
from tenshadows.export import export_city
from tenshadows.fetch import fetch_buildings, fetch_graph, write_fixture
from tenshadows.graph import street_graph
from tenshadows.heights import resolve_frame
from tenshadows.reference import write_reference


app = typer.Typer(add_completion=False, help="TenShadows data pipeline.")


def _build(city: City) -> None:
    buildings = resolve_frame(fetch_buildings(city))
    streets = street_graph(fetch_graph(city), city)
    target = export_city(city, streets, buildings)

    meta = json.loads((target / "meta.json").read_text(encoding="utf-8"))
    counts = meta["counts"]

    typer.echo(f"{city.display_name} ({city.key})")
    typer.echo(f"  graph      {counts['nodes']} nodes, {counts['edges']} edges")
    typer.echo(f"  buildings  {counts['buildings']}")
    shares = "  ".join(f"{k} {v:.1%}" for k, v in meta["height_provenance"].items())
    typer.echo(f"  heights    {shares}")
    typer.echo(f"  written    {target}")


@app.command()
def build(
    city: str = typer.Option(None, "--city", help="City key, i.e. a filename in cities/."),
    build_all: bool = typer.Option(False, "--all", help="Build every defined city."),
) -> None:
    """Fetch a city and write its artifacts under web/static/data/."""
    if build_all:
        targets = list(all_cities())
    elif city is not None:
        targets = [get_city(city)]
    else:
        raise typer.BadParameter("give --city <key> or --all. `tenshadows cities` lists them.")

    for target in targets:
        _build(target)


@app.command()
def cities() -> None:
    """List the defined cities."""
    for city in all_cities():
        typer.echo(f"{city.key:16s} {city.display_name:16s} EPSG:{city.expected_utm_epsg}")


@app.command()
def fixture() -> None:
    """Rebuild the mini test fixture from OSM. Hits the network."""
    typer.echo(str(write_fixture()))


@app.command()
def reference() -> None:
    """Regenerate the values the browser test suite asserts against."""
    typer.echo(str(write_reference()))


if __name__ == "__main__":
    app()
