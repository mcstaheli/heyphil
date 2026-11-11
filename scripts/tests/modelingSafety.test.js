import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { financialModelOnly, referencesOtherSheet, FROZEN_FONT_COLOR } from '../../server/modeling/export-xlsx.js';

const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'server', 'modeling');
const src = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

test('Modeling never deletes, trashes, empties trash or moves Drive files', () => {
  for (const f of [...files.map(src), fs.readFileSync(path.join(dir, '..', 'routes', 'modeling.js'), 'utf8')]) {
    assert.doesNotMatch(f, /files\.delete|\.emptyTrash|trashed:\s*true|addParents|removeParents|permissions\.delete|deleteSheet|drives\.delete/);
  }
});

test('only drive-guard.js can reach Google', () => {
  for (const f of files.filter((x) => x !== 'drive-guard.js')) {
    assert.doesNotMatch(src(f), /from 'googleapis'/, `${f} must go through drive-guard.js`);
  }
  // and the routes/importer reach Drive only through the guard
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '..', 'routes', 'modeling.js'), 'utf8'), /googleapis/);
});

test('every exported drive-guard call checks the HeyPhil boundary first', () => {
  // (readCells itself starts with assertInside - checked below)
  const guard = src('drive-guard.js');
  const fns = [...guard.matchAll(/export async function (\w+)\(([^)]*)\)\s*\{\n([\s\S]*?)\n\}/g)];
  assert.ok(fns.length >= 10);
  for (const [, name, , body] of fns) {
    if (name === 'assertInside') continue;
    assert.match(body, /assertInside\(|getFile\(|assertHeyPhilCopy\(|listChildren\(|findChildFolder\(|createFolder\(|readCells\(/, `${name} has no boundary check`);
  }
  // nothing is trusted from an earlier check (a folder can be moved out)
  assert.doesNotMatch(guard, /known:|verified\./);
});

test('cell writes only go to copies HeyPhil made', () => {
  assert.match(src('drive-guard.js'), /export async function writeCells[\s\S]*?await assertHeyPhilCopy\(spreadsheetId\)/);
});

test('referencesOtherSheet: tab references, not text that happens to contain "!"', () => {
  assert.equal(referencesOtherSheet("'Financial Model'!$E$9&\" | X\""), true);
  assert.equal(referencesOtherSheet('Operations!I27'), true);
  assert.equal(referencesOtherSheet('SUM(A1:A9)*2'), false);
  assert.equal(referencesOtherSheet('IF(A1>0,"Hi!","")'), false);
  assert.equal(referencesOtherSheet("'Financial Model'!C1", 'Financial Model'), false);
  assert.equal(referencesOtherSheet('A1*TaxRate', 'Financial Model', new Set(['taxrate'])), true);
});

test('financialModelOnly: keeps one tab, freezes cross-tab formulas in blue, un-shares the rest', async () => {
  const wb = new ExcelJS.Workbook();
  const fm = wb.addWorksheet('Financial Model');
  const ops = wb.addWorksheet('Operations');
  ops.getCell('A1').value = 42;
  fm.getCell('A1').value = { formula: 'Operations!A1', result: 42 };
  fm.getCell('A2').value = { formula: 'A1*2', result: 84 };
  fm.getCell('B2').value = { sharedFormula: 'A2', result: 0 }; // copy of A2 -> B1*2
  fm.getCell('A3').value = 'label!';
  const { buffer, frozen } = await financialModelOnly(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(frozen, 1);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  assert.deepEqual(out.worksheets.map((w) => w.name), ['Financial Model']);
  const ws = out.getWorksheet('Financial Model');
  assert.equal(ws.getCell('A1').value, 42);
  assert.equal(ws.getCell('A1').font.color.argb, FROZEN_FONT_COLOR);
  assert.equal(ws.getCell('A2').formula, 'A1*2');
  assert.equal(ws.getCell('B2').formula, 'B1*2');
  assert.equal(ws.getCell('B2').value.sharedFormula, undefined);
  assert.equal(ws.getCell('A3').value, 'label!');
  await assert.rejects(financialModelOnly(Buffer.from(await wb.xlsx.writeBuffer()), 'Nope'), /no "Nope" tab/);
});

test('financialModelOnly: a frozen shared-formula master does not break its copies', async () => {
  const wb = new ExcelJS.Workbook();
  const fm = wb.addWorksheet('Financial Model');
  wb.addWorksheet('Operations').getCell('A1').value = 42;
  fm.getCell('A2').value = { formula: 'Operations!A1*2', result: 84 };
  fm.getCell('B2').value = { sharedFormula: 'A2', result: 86 }; // Operations!B1*2
  const { buffer, frozen } = await financialModelOnly(Buffer.from(await wb.xlsx.writeBuffer()));
  assert.equal(frozen, 2);
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  assert.equal(out.worksheets[0].getCell('B2').value, 86);
});

test('financialModelOnly: own-tab references stay live; names on other tabs are frozen', async () => {
  const wb = new ExcelJS.Workbook();
  const fm = wb.addWorksheet('Financial Model');
  wb.addWorksheet('Operations').getCell('A1').value = 0.1;
  fm.getCell('C1').value = 5;
  fm.getCell('C2').value = { formula: "'Financial Model'!C1+1", result: 6 };
  fm.getCell('C3').value = { formula: 'C1*TaxRate', result: 0.5 };
  fm.getCell('C4').value = { formula: 'C1*Local', result: 10 };
  wb.definedNames.add('Operations!$A$1', 'TaxRate');
  wb.definedNames.add("'Financial Model'!$C$1", 'Local');
  const { buffer } = await financialModelOnly(Buffer.from(await wb.xlsx.writeBuffer()));
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(buffer);
  const ws = out.worksheets[0];
  assert.equal(ws.getCell('C2').formula, "'Financial Model'!C1+1");
  assert.equal(ws.getCell('C3').value, 0.5);
  assert.equal(ws.getCell('C4').formula, 'C1*Local');
  assert.deepEqual(out.definedNames.model.map((n) => n.name), ['Local']);
});
