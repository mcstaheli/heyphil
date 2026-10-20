// Report export for a site: every scheme's numbers side by side, as a CSV
// to open in Excel or Sheets, or as a printable page.
import { compareColumns, yieldOf } from './results';

// One table: a header row (scheme names), then a row per measure.
export function reportTable(schemes, results) {
  const { columns, keys } = compareColumns(schemes, results, (s, type, r, m) => {
    const y = yieldOf(type, m);
    const checks = r?.checks || [];
    const fails = checks.filter((c) => c.status === 'fail').map((c) => c.label);
    return [
      ['Asset type', type.label],
      ['Yield', `${y.value} ${y.label}`.trim()],
      ['Zoning check', checks.length ? (fails.length ? `Fails: ${fails.join(', ')}` : 'Passes') : '-'],
    ];
  });
  return {
    header: ['', ...columns.map((c) => c.scheme.name)],
    rows: keys.map((k) => [k, ...columns.map((c) => c.rows[k] ?? '')]),
  };
}

// RFC 4180: quote every cell, double any quote inside. Scheme names are
// typed by people, so one starting like a formula (=, +, -, @) gets a
// leading apostrophe and opens as text, not a formula.
export function toCsv(table) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const safe = (v) => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : v);
  return [table.header.map(safe), ...table.rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A self-contained printable page: the site, then the comparison table
// and each scheme's zoning checks.
export function reportHtml({ siteName, projectTitle, schemes, results, generatedAt }) {
  const table = reportTable(schemes, results);
  const checkBlocks = schemes.map((s) => {
    const checks = results[s.id]?.checks || [];
    if (!checks.length) return '';
    const rows = checks.map((c) => `<tr><td>${{ pass: '✅', fail: '❌', none: '—' }[c.status]}</td><td>${escapeHtml(c.label)}</td><td>${escapeHtml(c.limit ?? 'No limit')}</td><td>${escapeHtml(c.actual)}</td></tr>`).join('');
    return `<h3>${escapeHtml(s.name)} - zoning check</h3><table class="checks">${rows}</table>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(siteName)} - site report</title>
<style>
body { font: 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; margin: 32px; }
h1 { font-size: 20px; margin: 0 0 4px; } h3 { font-size: 13px; margin: 18px 0 6px; }
.meta { color: #555; margin-bottom: 16px; }
table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
th, td { border-bottom: 1px solid #ddd; padding: 4px 8px; text-align: right; font-variant-numeric: tabular-nums; }
th:first-child, td:first-child { text-align: left; color: #555; }
th { background: #f3f4f6; }
table.checks td { text-align: left; }
.note { color: #777; font-size: 11px; margin-top: 16px; }
@media print { body { margin: 12mm; } }
</style></head><body>
<h1>${escapeHtml(siteName)}</h1>
<div class="meta">${projectTitle ? `${escapeHtml(projectTitle)} · ` : ''}Site Planner report · ${escapeHtml(generatedAt)}</div>
<table><thead><tr>${table.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
<tbody>${table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
${checkBlocks}
<p class="note">A rules-based test fit from HeyPhil's Site Planner. Pro forma inputs are rough starting points, not market data.</p>
</body></html>`;
}
