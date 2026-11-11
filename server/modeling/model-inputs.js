// Modeling (Labs) - reading a model's inputs for the input screens: every
// mapped input with its question, the cells it covers, its current values
// (display + raw, in the field's own layout) and which cells are formulas.
import * as g from './drive-guard.js';
import { mapFor } from './results.js';
import { cellsFor, toFieldLayout } from './inputs.js';

export async function readInputs(model) {
  const m = await mapFor(model);
  if (!m.map || !m.map.inputs.length) return { steps: [], fields: [], problems: m.problems, mapSource: m.source };
  const defs = await g.readNamedRangeDefs(model.fileId);
  const usable = m.map.inputs.filter((i) => defs[i.target] && (i.kind !== 'target' || defs[i.options]));
  const targets = [...new Set(usable.flatMap((i) => (i.kind === 'target' ? [i.target, i.options] : [i.target])))];
  const [values, formulas] = await Promise.all([
    g.readNamedValues(model.fileId, targets),
    g.readFormulaFlags(model.fileId, [...new Set(usable.map((i) => i.target))]),
  ]);
  const fields = usable.map((i) => {
    const def = defs[i.target];
    const base = { ...i, cells: cellsFor(i, def) };
    if (i.kind === 'target') {
      const out = values[i.options] || {};
      const adj = values[i.target] || {};
      const adjIsFormula = (formulas[i.target] || [])[0]?.[0] === true;
      return { ...base, display: out.display ?? null, raw: out.raw ?? null, adjRaw: adj.raw ?? 0, adjDisplay: adj.display ?? null, adjIsFormula };
    }
    const v = values[i.target] || {};
    // formula flags come back trimmed like values; pad to the range first
    const flagGrid = formulas[i.target] || [];
    return {
      ...base,
      display: toFieldLayout(i, def, v.display),
      raw: toFieldLayout(i, def, v.raw),
      formula: toFieldLayout({ ...i, type: 'flag' }, def, flagGrid.length ? flagGrid : [[false]]),
    };
  });
  return { steps: m.map.steps, fields, problems: m.problems, mapSource: m.source };
}
