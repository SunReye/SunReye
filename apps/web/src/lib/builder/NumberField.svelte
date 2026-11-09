<script lang="ts">
  let {
    label,
    value,
    onchange,
    min,
    max,
  }: {
    label: string;
    value: number;
    onchange: (value: number) => void;
    min?: number;
    max?: number;
  } = $props();
</script>

<label>
  {label}
  <input
    type="number"
    step="0.1"
    {min}
    {max}
    {value}
    oninput={(event) => {
      const next = event.currentTarget.valueAsNumber;

      // A half-typed number is no scene yet.
      if (Number.isFinite(next)) onchange(next);
    }}
  />
</label>

<style>
  label {
    display: grid;
    gap: 0.25rem;
    font-size: 0.875rem;
  }

  input {
    width: 7rem;
  }
</style>
