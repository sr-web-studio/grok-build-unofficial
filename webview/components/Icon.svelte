<script lang="ts" module>
  /**
   * Lucide (https://lucide.dev) glyphs, inlined as path data.
   *
   * The design system calls for Lucide throughout, but the webview CSP is `font-src ${cspSource}`
   * with no stylesheet of our own — an icon font would have to be bundled and served, and
   * codicons are not exposed to webviews either. Path data costs a few hundred bytes and renders
   * at any size in `currentColor`, so the icons follow the theme for free.
   *
   * Circles and rects are expressed as paths so the renderer stays a single `{#each}`.
   */
  export const icons = {
    plus: ['M5 12h14', 'M12 5v14'],
    clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 6v6l4 2'],
    rewind: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
    restart: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
    sparkles: [
      'M12 3 10.4 8.4 5 10l5.4 1.6L12 17l1.6-5.4L19 10l-5.4-1.6z',
      'M19 3v3',
      'M20.5 4.5h-3',
      'M5 17v2',
      'M6 18H4',
    ],
    ellipsis: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    settings: [
      'M20 7h-9',
      'M14 17H5',
      'M17 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
      'M7 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    ],
    server: ['M2 2h20v8H2z', 'M2 14h20v8H2z', 'M6 6h.01', 'M6 18h.01'],
    layers: ['M12 2 2 7l10 5 10-5-10-5z', 'm2 17 10 5 10-5', 'm2 12 10 5 10-5'],
    list: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
    warning: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z', 'M12 9v4', 'M12 17h.01'],
    info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'M12 16v-4', 'M12 8h.01'],
    edit: [
      'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
      'M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4z',
    ],
    terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
    file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z', 'M14 2v5h5', 'M9 13h6', 'M9 17h4'],
    search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16', 'm21 21-4.35-4.35'],
    chevron: ['m6 9 6 6 6-6'],
    check: ['M20 6 9 17l-5-5'],
    trash: [
      'M3 6h18',
      'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
      'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      'M10 11v6',
      'M14 11v6',
    ],
    close: ['M18 6 6 18', 'm6 6 12 12'],
  } as const;

  export type IconName = keyof typeof icons;
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: number;
  }

  let { name, size = 14 }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#each icons[name] as d (d)}
    <path {d} />
  {/each}
</svg>

<style>
  /* Inline by default, so an icon next to a label sits on the text baseline row rather than
     pushing the line box taller. */
  .icon {
    display: block;
    flex: 0 0 auto;
  }
</style>
