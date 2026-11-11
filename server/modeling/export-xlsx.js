// Modeling (Labs) - turns a whole-workbook .xlsx (Drive's export of the
// model) into the same file the sheet menu's "Export to Excel…" makes:
// only the export tab (Financial Model), with every formula that points
// at another tab frozen to its value in blue so the numbers stand on
// their own. Formulas within the tab stay live. Runs in memory - nothing
// temporary is created in Drive.
import ExcelJS from 'exceljs';

export const FROZEN_FONT_COLOR = 'FF0000FF'; // blue: "this was a link to another tab"

// Does formula text reference a tab other than `keepSheet`? ('Tab'!A1 or
// Tab!A1, ignoring "string literals"), or use a named range that points
// at another tab (`foreignNames`, lower-case)?
export function referencesOtherSheet(formula, keepSheet = null, foreignNames = new Set()) {
  const code = String(formula || '').replace(/"(?:[^"]|"")*"/g, '""');
  const keep = keepSheet ? keepSheet.toLowerCase() : null;
  for (const m of code.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/g)) {
    const tab = (m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]).toLowerCase();
    if (tab !== keep) return true;
  }
  if (foreignNames.size) {
    for (const m of code.matchAll(/[A-Za-z_\\][\w.]*/g)) {
      if (foreignNames.has(m[0].toLowerCase())) return true;
    }
  }
  return false;
}

function scalarResult(result) {
  if (result === undefined || result === null) return null;
  if (typeof result === 'object' && result.error) return { error: result.error };
  return result;
}

export async function financialModelOnly(xlsxBuffer, sheetName = 'Financial Model') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsxBuffer);
  const keep = wb.getWorksheet(sheetName);
  if (!keep) throw new Error(`The workbook has no "${sheetName}" tab to export.`);

  // Named ranges that point at another tab: formulas using them must be
  // frozen too (the names go when the other tabs do).
  const names = wb.definedNames;
  const foreign = (names.model || []).filter((n) => (n.ranges || []).some((r) => referencesOtherSheet(r, sheetName)));
  const foreignNames = new Set(foreign.map((n) => n.name.toLowerCase()));

  // Read every formula first, THEN change cells: a shared formula's copies
  // read their text from the master cell, which may itself get frozen.
  const cells = [];
  keep.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (cell.type === ExcelJS.ValueType.Formula) cells.push({ cell, formula: cell.formula, result: scalarResult(cell.result) });
    });
  });
  let frozen = 0;
  for (const { cell, formula, result } of cells) {
    if (referencesOtherSheet(formula, sheetName, foreignNames)) {
      cell.value = result;
      cell.font = { ...(cell.font || {}), color: { argb: FROZEN_FONT_COLOR } };
      frozen += 1;
    } else {
      // un-shared: each copy keeps its own formula
      cell.value = result === null ? { formula } : { formula, result };
    }
  }

  // drop every other tab
  wb.worksheets.filter((ws) => ws.id !== keep.id).forEach((ws) => wb.removeWorksheet(ws.id));

  // names and validations that pointed at a removed tab would make Excel
  // "repair" the file on open
  foreign.forEach((n) => (n.ranges || []).forEach((r) => names.remove(r, n.name)));
  const dv = keep.dataValidations.model || {};
  Object.keys(dv).forEach((addr) => {
    if ((dv[addr]?.formulae || []).some((f) => referencesOtherSheet(f, sheetName, foreignNames))) delete dv[addr];
  });
  keep.conditionalFormattings = (keep.conditionalFormattings || []).filter((cf) => !(cf.rules || [])
    .some((r) => (r.formulae || []).some((f) => referencesOtherSheet(f, sheetName, foreignNames))));

  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer: out, frozen };
}
