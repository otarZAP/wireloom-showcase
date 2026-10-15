// The Wireloom mark: three wires woven on a perfboard — the vertical one passes over
// the orange wire and under the blue one, like threads on a loom. This is the ONLY
// copy of the logo: the header, the favicon and the app icon (tools/make-icon.mjs) all
// come from here.
const BG = '#0d1f16';
export const LOGO = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<rect x="4" y="4" width="56" height="56" rx="12" fill="${BG}" stroke="#2e5a3c" stroke-width="3"/>
<path d="M15 24 H49" stroke="#f0883e" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M32 18 V30" stroke="${BG}" stroke-width="10" fill="none"/>
<path d="M32 14 V50" stroke="#2ee6a6" stroke-width="5" stroke-linecap="round" fill="none"/>
<path d="M25 40 H39" stroke="${BG}" stroke-width="10" fill="none"/>
<path d="M15 40 H49" stroke="#58a6ff" stroke-width="5" stroke-linecap="round" fill="none"/>
<g fill="#d9a441" stroke="${BG}" stroke-width="1.5">
<circle cx="15" cy="24" r="4"/><circle cx="49" cy="24" r="4"/><circle cx="15" cy="40" r="4"/>
<circle cx="49" cy="40" r="4"/><circle cx="32" cy="14" r="4"/><circle cx="32" cy="50" r="4"/></g>
</svg>`;

export const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(LOGO.replace('<svg ', '<svg width="64" height="64" '));
