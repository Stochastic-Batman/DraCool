<script>
  import { isNight } from "$lib/solar.js";

  let { sun } = $props();

  // Looking down on the sky. North is up and azimuth runs clockwise, matching
  // the convention every angle in this codebase is stated in. The rim is the
  // horizon and the centre is straight overhead, so the marker walks inward as
  // the sun climbs -- which is also why shadows shorten as it approaches the
  // middle.
  const R = 30;
  const night = $derived(isNight(sun));
  const reach = $derived(R * (1 - Math.max(sun.alt, 0) / 90));
  const rad = $derived((sun.azi * Math.PI) / 180);
  const cx = $derived(reach * Math.sin(rad));
  const cy = $derived(-reach * Math.cos(rad));
</script>

<div class="dial">
  <svg viewBox="-38 -38 76 76" width="76" height="76" aria-hidden="true">
    <circle class="rim" cx="0" cy="0" r={R} />
    <circle class="rim inner" cx="0" cy="0" r={R / 2} />
    <line class="tick" x1="0" y1={-R} x2="0" y2={R} />
    <line class="tick" x1={-R} y1="0" x2={R} y2="0" />
    <text class="rose" x="0" y={-R - 3}>N</text>
    {#if !night}
      <circle class="sun" cx={cx} cy={cy} r="4.5" />
    {/if}
  </svg>

  <dl>
    <dt>altitude</dt>
    <dd>{sun.alt.toFixed(1)}°</dd>
    <dt>azimuth</dt>
    <dd>{sun.azi.toFixed(1)}°</dd>
  </dl>
</div>

<!-- Definition 1: below the horizon sigma is fixed at 1 for every edge by
     convention. Nothing is measured there, so the interface says so instead of
     presenting a shade-optimised route that is nothing of the kind. -->
{#if night}
  <p class="night">
    The sun is down. σ = 1 everywhere by convention, so the router is returning a
    plain shortest path.
  </p>
{/if}

<style>
  .dial {
    display: grid;
    grid-template-columns: 76px 1fr;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
  }

  .rim {
    fill: none;
    stroke: #d6d3cd;
    stroke-width: 1;
  }

  .inner {
    stroke-dasharray: 2 3;
  }

  .tick {
    stroke: #e3e0da;
    stroke-width: 1;
  }

  .rose {
    fill: #6b6a66;
    font-size: 8px;
    text-anchor: middle;
  }

  .sun {
    fill: #eda100;
    stroke: #ffffff;
    stroke-width: 1.5;
  }

  dl {
    display: grid;
    grid-template-columns: auto auto;
    gap: 1px 8px;
    margin: 0;
  }

  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .night {
    margin: 8px 0 0;
    color: #3f4a63;
  }
</style>
