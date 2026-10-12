// Mixes a hex color with black, like CSS `color-mix(in srgb, <hex> <keep>, black)`.
// Done in JS because Chrome reports a computed color-mix() as `color(srgb ...)`,
// which html2canvas 1.4.1 can't parse - it made the 📸 reporter fail on every
// page showing the timeline (#34). Anything that isn't a hex color is
// returned as is.
export function darkenHex(hex, keep = 0.8) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return hex;
  const digits = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => Math.round(parseInt(digits.slice(i, i + 2), 16) * keep));
  return `rgb(${r}, ${g}, ${b})`;
}
