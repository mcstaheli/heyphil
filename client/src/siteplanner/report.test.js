import { reportHtml, reportTable, toCsv } from './report';
import { solveScheme } from './solver';

function rectSite(width, depth, lat = 40.76, lng = -111.89) {
  const dx = width / (364000 * Math.cos((lat * Math.PI) / 180));
  const dy = depth / 364000;
  return { type: 'Polygon', coordinates: [[[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy], [lng, lat]]] };
}

const site = rectSite(600, 400);
const schemes = [
  { id: 'a', name: 'Scheme "A"', assetType: 'mf-garden', overrides: {} },
  { id: 'b', name: 'Hotel, 5 floors', assetType: 'hotel', overrides: { floors: 5 } },
];
const results = Object.fromEntries(schemes.map((s) => [s.id, solveScheme(site, s)]));

test('report table: a column per scheme, shared rows lined up', () => {
  const t = reportTable(schemes, results);
  expect(t.header).toEqual(['', 'Scheme "A"', 'Hotel, 5 floors']);
  const yieldRow = t.rows.find((r) => r[0] === 'Yield');
  expect(yieldRow[1]).toMatch(/units/);
  expect(yieldRow[2]).toMatch(/keys/);
  expect(t.rows.find((r) => r[0] === 'Units')[2]).toBe('');
  expect(t.rows.some((r) => r[0] === 'Yield on cost')).toBe(true);
});

test('CSV quotes every cell and doubles quotes', () => {
  const csv = toCsv({ header: ['', 'Scheme "A"'], rows: [['Yield', '1,234 units']] });
  expect(csv).toBe('"","Scheme ""A"""\r\n"Yield","1,234 units"');
});

test('printable report escapes names', () => {
  const html = reportHtml({ siteName: '<b>Lot</b>', projectTitle: 'Zion', schemes, results, generatedAt: 'Oct 20' });
  expect(html).toContain('&lt;b&gt;Lot&lt;/b&gt;');
  expect(html).not.toContain('<b>Lot</b>');
  expect(html).toContain('class="checks"');
});


test('a scheme name that looks like a formula opens as text', () => {
  const csv = toCsv({ header: ['', '=HYPERLINK("x")'], rows: [['Profit', '-$5.5M']] });
  expect(csv.split('\r\n')[0]).toBe('"","\'=HYPERLINK(""x"")"');
  expect(csv).toContain('"-$5.5M"');
});

test('the report includes a plan drawing per scheme', () => {
  const html = reportHtml({ siteName: 'Lot', schemes, results, generatedAt: 'Oct 20', boundary: site });
  expect((html.match(/<svg/g) || []).length).toBe(schemes.length);
  expect(html).toMatch(/ft<\/text>/);
});
