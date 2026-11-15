<!--
  The error screen's mark: the brand's sun behind a cloud that drifted in front of it. The rays
  turn and the cloud floats; both rest on the still tier and under reduced motion (ADR 21).
-->
<svg viewBox="0 0 60 46" class="h-16 w-auto" fill="none" aria-hidden="true" data-error-mark>
  <g class="text-brand">
    <g class="rays" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <line x1="42" y1="2" x2="42" y2="5" /><line x1="42" y1="27" x2="42" y2="30" />
      <line x1="28" y1="16" x2="31" y2="16" /><line x1="53" y1="16" x2="56" y2="16" />
      <line x1="32.1" y1="6.1" x2="34.2" y2="8.2" /><line x1="49.8" y1="23.8" x2="51.9" y2="25.9" />
      <line x1="51.9" y1="6.1" x2="49.8" y2="8.2" /><line x1="34.2" y1="23.8" x2="32.1" y2="25.9" />
    </g>
    <circle cx="42" cy="16" r="7" fill="currentColor" />
  </g>
  <g class="arrive">
    <!-- Filled with the surface under it, so it covers the sun. -->
    <path
      class="cloud text-muted-foreground"
      transform="translate(4 12) scale(1.6)"
      d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"
      fill="var(--card)"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  </g>
</svg>

<style>
  .rays {
    transform-box: view-box;
    transform-origin: 42px 16px;
    animation: turn 24s linear infinite;
  }
  .arrive {
    animation: arrive 700ms var(--motion-ease) both;
  }
  .cloud {
    animation: float 5s var(--motion-ease-in-out) 700ms infinite alternate;
  }

  @keyframes turn {
    to {
      rotate: 360deg;
    }
  }
  @keyframes arrive {
    from {
      opacity: 0;
      translate: -10px 0;
    }
  }
  @keyframes float {
    to {
      translate: 2.5px 0;
    }
  }

  :global([data-motion="still"]) :is(.rays, .arrive, .cloud) {
    animation: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .rays,
    .arrive,
    .cloud {
      animation: none;
    }
  }
</style>
