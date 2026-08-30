<script>
  let { route, night } = $props();

  // Section 6.1 fixes what w means: how much extra walking is worth one metre
  // of sun avoided. Neither half of that trade can be judged alone, so the
  // detour and the sun it bought are shown together, both measured against the
  // w = 0 route rather than against nothing.
  const km = (m) => `${(m / 1000).toFixed(2)} km`;
  const detour = $derived(route.metres / route.baseMetres - 1);
  const saved = $derived(route.baseSun - route.sun);
</script>

<dl>
  <dt>walk</dt>
  <dd>{km(route.metres)}</dd>
  <dt>in sun</dt>
  <dd>{km(route.sun)}</dd>
  <dt>detour</dt>
  <dd>{detour < 0.0005 ? "none" : `+${(detour * 100).toFixed(0)}%`}</dd>
</dl>

{#if night}
  <p class="note">Shade is not being measured, so this is the shortest path.</p>
{:else if saved < 0.5 && detour < 0.005}
  <p class="note">
    No shadier way round. This is the shortest path, and raising w will not change it.
  </p>
{:else if detour < 0.005}
  <p class="note">Same distance as the shortest path, {saved.toFixed(0)} m less sun.</p>
{:else}
  <p class="note">
    {(detour * 100).toFixed(0)}% further to keep {saved.toFixed(0)} m out of the sun.
  </p>
{/if}

<style>
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

  .note {
    margin: 6px 0 0;
    color: #52514e;
  }
</style>
