// A simple development pro forma for a Site Planner scheme: what it costs
// to build what the solver laid out, what it earns, and what that's worth.
// Inputs are the scheme's settings (PROFORMA_FIELDS in assetTypes.js);
// quantities come from the solver's metrics.

const pct = (v) => (v || 0) / 100;

// One part of a scheme (the main layout, or one space). `type` is its
// asset type, `s` its effective settings, `m` its metrics.
export function proformaFor(type, s, m) {
  const homes = type.mode === 'lots' ? m.units : 0;
  const hardCost = m.gsf * (s.hardCostPerSf || 0)
    + (m.parkingSurface || 0) * (s.surfaceStallCost || 0)
    + (m.parkingStructured || 0) * (s.structuredStallCost || 0)
    + homes * (s.lotDevCost || 0)
    + (m.itMw || 0) * (s.costPerMw || 0);
  const landCost = s.landCost || 0;
  const softCost = hardCost * pct(s.softCostPct);
  const totalCost = landCost + hardCost + softCost;
  const out = {
    kind: type.mode === 'lots' ? 'sale' : 'rental',
    landCost,
    hardCost,
    softCost,
    totalCost,
    revenue: 0,
    gpr: 0,
    egi: 0,
    noi: 0,
    value: 0,
    profit: 0,
  };

  if (out.kind === 'sale') {
    out.revenue = homes * (s.salePrice || 0);
    out.value = out.revenue * (1 - pct(s.sellingCostPct));
  } else {
    if (type.yieldKind === 'units') {
      out.gpr = (m.nsf * (s.rentPerSfMonth || 0) + m.units * (s.otherIncomePerUnitMonth || 0)) * 12;
    } else if (type.yieldKind === 'keys') {
      out.gpr = m.keys * (s.adr || 0) * 365 * pct(s.occupancyPct);
    } else if (type.yieldKind === 'mw') {
      out.gpr = (m.itMw || 0) * 1000 * (s.rentPerKwMonth || 0) * 12;
    } else if (type.yieldKind === 'stalls') {
      out.gpr = m.parkingProvided * (s.revenuePerStallMonth || 0) * 12;
    } else {
      out.gpr = m.nsf * (s.rentPerSfYear || 0);
    }
    // A hotel's occupancy already stands in for vacancy.
    out.egi = type.yieldKind === 'keys' ? out.gpr : out.gpr * (1 - pct(s.vacancyPct));
    out.noi = out.egi * (1 - pct(s.opexPct));
    out.value = s.exitCapPct > 0 ? out.noi / pct(s.exitCapPct) : 0;
  }
  out.profit = out.value - totalCost;
  return finish(out);
}

function finish(p) {
  return {
    ...p,
    yieldOnCost: p.totalCost > 0 && p.noi > 0 ? p.noi / p.totalCost : 0,
    margin: p.totalCost > 0 ? p.profit / p.totalCost : 0,
  };
}

// Adds parts together (a mixed-use scheme): sums, then ratios again.
export function combineProformas(parts) {
  if (parts.length === 1) return parts[0];
  const keys = ['landCost', 'hardCost', 'softCost', 'totalCost', 'revenue', 'gpr', 'egi', 'noi', 'value', 'profit'];
  const sum = Object.fromEntries(keys.map((k) => [k, parts.reduce((s, p) => s + (p[k] || 0), 0)]));
  const kinds = new Set(parts.map((p) => p.kind));
  return finish({ ...sum, kind: kinds.size === 1 ? [...kinds][0] : 'mixed' });
}
