// Modeling (Labs) - reading a model's results (its out_* named ranges) and
// the map that says how to show them.
//
// The map comes from the model's own "HeyPhil Map" tab. A model made before
// its template had a map (e.g. from v1.2) borrows the map of its
// template's Active model; outputs the file doesn't have are just left
// out. A locked model's results come from the snapshot taken when it was
// locked (it can't change), falling back to a live read.
import * as g from './drive-guard.js';
import * as db from './db.js';
import { parseMap, groupOutputs, MAP_TAB, MAP_RANGE } from './map.js';
import { rootTemplate } from './operations.js';
import { ModelingError, isLockedRestriction } from './rules.js';

const TTL_MS = 60 * 1000;
const cache = new Map(); // key -> { at, value }
const cached = async (key, fn, ttl = TTL_MS) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
};
export const forget = (modelId) => { for (const k of cache.keys()) if (k.endsWith(`:${modelId}`)) cache.delete(k); };
// Refresh / lock: also re-read the maps (someone may have just edited one).
const forgetMaps = () => { for (const k of cache.keys()) if (k.startsWith('map:')) cache.delete(k); };

async function mapOfFile(fileId) {
  return cached(`map:${fileId}`, async () => {
    const { tabs, names } = await g.readStructure(fileId);
    if (!tabs.has(MAP_TAB)) return { map: null, names };
    const [rows] = await g.readCells(fileId, [MAP_RANGE]);
    const map = parseMap(rows);
    return { map: map.outputs.length || map.inputs.length ? map : null, names, problems: map.problems };
    // (a map with inputs but no outputs borrows the template's outputs - see mapFor)
  }, 5 * TTL_MS);
}

// { map, source: 'own' | 'template', names (the file's named ranges) }
export async function mapFor(model) {
  const own = await mapOfFile(model.fileId);
  if (own.map && own.map.outputs.length) return { map: own.map, source: 'own', names: own.names, problems: own.problems || [] };
  const template = await rootTemplate(model);
  const active = template ? await db.activeModel({ templateId: template.id }) : null;
  if (active && active.fileId !== model.fileId) {
    const t = await mapOfFile(active.fileId);
    if (t.map) {
      // the model's own inputs (if it has a partial map) with the template's outputs
      const map = own.map ? { ...t.map, inputs: own.map.inputs.length ? own.map.inputs : t.map.inputs, steps: own.map.steps.length ? own.map.steps : t.map.steps } : t.map;
      return { map, source: 'template', templateVersion: active.version, names: own.names, problems: [...(own.problems || []), ...(t.problems || [])] };
    }
  }
  return { map: own.map, source: own.map ? 'own' : null, names: own.names, problems: [...(own.problems || []), 'No results map found for this model or its template.'] };
}

// Live read of every mapped output the file has.
async function readOutputs(model, map, names) {
  const wanted = map.outputs.map((o) => o.name).filter((n) => names.has(n));
  return g.readNamedValues(model.fileId, wanted);
}

// { groups, headline, source: 'live' | 'snapshot', readAt, mapSource }
export async function resultsFor(modelId, { refresh = false } = {}) {
  const model = await db.getModel(modelId);
  if (!model) throw new ModelingError('Not found', 404);
  if (refresh) { forget(modelId); forgetMaps(); }
  return cached(`results:${modelId}`, async () => {
    const m = await mapFor(model);
    if (!m.map || !m.map.outputs.length) return { modelId, groups: [], headline: [], source: null, problems: m.problems };
    let values;
    let source = 'live';
    let readAt = new Date().toISOString();
    let snap = model.locked ? await db.latestSnapshot(model.id, 'outputs') : null;
    if (snap) {
      // only trust the snapshot while the file really is locked (a drive
      // Manager can unlock it by hand and edit it)
      const meta = await g.getFile(model.fileId);
      if (!isLockedRestriction(meta.contentRestrictions)) {
        await db.markUnlocked(model.id);
        snap = null;
      }
    }
    if (snap) {
      values = { ...snap.data.values };
      source = 'snapshot';
      readAt = snap.capturedAt;
      // outputs added to the map since the snapshot: the locked file can't
      // change, so reading them live is the same as having snapshotted them
      const missing = m.map.outputs.map((o) => o.name).filter((n) => m.names.has(n) && !(n in values));
      if (missing.length) Object.assign(values, await g.readNamedValues(model.fileId, missing));
    } else {
      values = await readOutputs(model, m.map, m.names);
    }
    const groups = groupOutputs(m.map.outputs, values);
    const headline = groups.flatMap((gr) => gr.items.filter((i) => i.level === 'headline'));
    return { modelId, groups, headline, source, readAt, mapSource: m.source, mapTemplateVersion: m.templateVersion || null, problems: m.problems };
  });
}

// Taken when a model is locked: its outputs, and the raw values of every
// mapped input, so a locked version keeps a permanent record and compares
// instantly. Returns a short description.
export async function captureSnapshot(model, email) {
  forget(model.id);
  forgetMaps();
  const m = await mapFor(model);
  if (!m.map) return 'No map - nothing to snapshot';
  // read both first, then save both together - never half a snapshot
  const inputNames = [...new Set(m.map.inputs.map((i) => i.target).filter((n) => m.names.has(n)))];
  const [outputs, inputs] = await Promise.all([readOutputs(model, m.map, m.names), g.readNamedValues(model.fileId, inputNames)]);
  await db.insertSnapshots(model.id, [
    ['outputs', { values: outputs, mapSource: m.source }],
    ['inputs', { values: inputs, mapSource: m.source }],
  ], email);
  return `Saved ${Object.keys(outputs).length} results and ${Object.keys(inputs).length} inputs`;
}
