// The difference between two results, for the comparison table - mirrors
// outputDelta in server/modeling/map.js (tested on both sides).
// Percents compare in points, multiples in turns, money in short dollars.
export function outputDelta(type, base, other) {
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const a = num(base);
  const b = num(other);
  if (a === null || b === null) return null;
  const d = b - a;
  if (Math.abs(d) < 1e-9) return { value: 0, label: '-' };
  const sign = d > 0 ? '+' : '−';
  const abs = Math.abs(d);
  if (type === 'percent') return { value: d, label: `${sign}${(abs * 100).toFixed(1)} pts` };
  if (type === 'multiple') return { value: d, label: `${sign}${abs.toFixed(2)}x` };
  if (type === 'currency') {
    // thresholds sit where rounding would roll over ($999.6 -> $1K, not $1000)
    const short = abs >= 999500 ? `$${(abs / 1e6).toFixed(2)}M` : abs >= 999.5 ? `$${Math.round(abs / 1e3)}K` : `$${abs.toFixed(abs < 10 ? 2 : 0)}`;
    return { value: d, label: `${sign}${short}` };
  }
  return { value: d, label: `${sign}${abs.toLocaleString('en-US', { maximumFractionDigits: 2 })}` };
}

export function readAtLabel(r) {
  if (!r || !r.readAt) return '';
  const t = new Date(r.readAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return r.source === 'snapshot' ? `Snapshot saved when it was locked (${t})` : `Live from Google Sheets, read ${t}`;
}
