<script>
  // Section 6.1 gives w a concrete reading: the router will accept a route up
  // to (1 + w) times as long if it stays fully in shade. The label says that
  // rather than showing a bare number, because the number alone is not
  // something anyone can calibrate.
  let { w = $bindable() } = $props();

  const detour = $derived(`${((1 + w) * 100 - 100).toFixed(0)}% further for full shade`);
</script>

<div class="shade">
  <input type="range" min="0" max="3" step="0.05" bind:value={w} />
  <output>w {w.toFixed(2)}</output>
  <small>{w === 0 ? "shortest path" : detour}</small>
</div>

<style>
  .shade {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 8px;
    margin: 8px 0;
  }

  input {
    width: 100%;
  }

  output {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  small {
    grid-column: 1 / -1;
    color: #5b5b5b;
  }
</style>
