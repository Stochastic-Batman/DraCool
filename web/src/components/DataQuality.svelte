<script>
  let { provenance } = $props();

  // Section 7 calls sparse height data the dominant error source in the whole
  // system, so it travels with the artifacts and is shown rather than hidden.
  // The four sources are ordered best to worst, which makes this an ordinal
  // ramp: one hue, light to dark, the guesses darkest. Orange because the shade
  // overlay already holds the blue one, and two sequential scales on screen at
  // once need different hues. Validated against the panel surface at 2.17:1.
  const SOURCES = [
    { key: "tag", label: "height tag", color: "#ec9a72" },
    { key: "levels", label: "from levels", color: "#e07a42" },
    { key: "type", label: "by type", color: "#c25a24" },
    { key: "default", label: "flat default", color: "#853613" },
  ];

  const rows = $derived(SOURCES.map((s) => ({ ...s, share: provenance[s.key] ?? 0 })));
  const guessed = $derived((provenance.type ?? 0) + (provenance.default ?? 0));
  const pct = (v) => `${(v * 100).toFixed(v >= 0.1 ? 0 : 1)}%`;
</script>

<h2>Height data</h2>

<p class="lede">{pct(guessed)} of buildings are a guess, not a measurement.</p>

<!-- A 2px surface gap between segments, so adjacent shares stay countable
     rather than reading as one band. -->
<div class="bar">
  {#each rows as row (row.key)}
    {#if row.share > 0}
      <span style:width="{row.share * 100}%" style:background={row.color}></span>
    {/if}
  {/each}
</div>

<!-- Every segment is named and numbered here, so identity is never carried by
     colour alone. -->
<dl>
  {#each rows as row (row.key)}
    <dt><i style:background={row.color}></i>{row.label}</dt>
    <dd>{pct(row.share)}</dd>
  {/each}
</dl>

<style>
  h2 {
    margin: 0 0 4px;
    font-size: 13px;
  }

  .lede {
    margin: 0 0 6px;
    color: #6b5c3a;
  }

  .bar {
    display: flex;
    gap: 2px;
    height: 8px;
    margin-bottom: 6px;
    border-radius: 2px;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
  }

  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 1px 8px;
    margin: 0;
  }

  dt {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  i {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
