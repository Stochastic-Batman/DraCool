<script>
  import { utcToZoned, zonedToUtc } from "$lib/solar.js";

  // Roadmap open question 1, decided: the slider reads the city's wall clock
  // and the oracle takes UTC, so meta.json ships an IANA zone and the
  // conversion happens here. A fixed offset would be an hour wrong for half
  // the year in Saarbrücken.
  //
  // `when` is the only state: the fields below are read back out of it rather
  // than kept alongside it, so switching city re-reads the same instant in the
  // new zone and there is no second copy of the time to drift.
  let { tz, when = $bindable() } = $props();

  const local = $derived(utcToZoned(tz, when));
  const day = $derived(local.toISOString().slice(0, 10));
  const mins = $derived(local.getUTCHours() * 60 + local.getUTCMinutes());

  function set(onDay, atMins) {
    const [y, m, d] = onDay.split("-").map(Number);
    when = zonedToUtc(tz, y, m, d, Math.floor(atMins / 60), atMins % 60);
  }

  const pad = (v) => String(v).padStart(2, "0");
  const clock = $derived(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
</script>

<div class="time">
  <label>
    <input type="date" value={day} oninput={(e) => set(e.currentTarget.value, mins)} />
  </label>
  <input
    type="range"
    min="0"
    max="1439"
    step="5"
    value={mins}
    oninput={(e) => set(day, Number(e.currentTarget.value))}
  />
  <output>{clock}</output>
</div>

<style>
  .time {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 4px 8px;
    margin: 8px 0;
  }

  input[type="date"] {
    width: 100%;
    font: inherit;
  }

  input[type="range"] {
    width: 100%;
  }

  output {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  label {
    grid-column: 1 / -1;
  }
</style>
