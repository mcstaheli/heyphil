import { ASSET_TYPES, fieldsFor } from './assetTypes';
import { modelSteps } from './stepPlan';

test('every setting is in exactly one step, for every type', () => {
  for (const type of ASSET_TYPES) {
    const steps = modelSteps(type);
    const shown = steps.flatMap((st) => st.keys);
    expect(new Set(shown).size).toBe(shown.length);
    const expected = fieldsFor(type).filter((f) => !(type.mode === 'lots' && f.group === 'Parking')).map((f) => f.key);
    expect(shown.filter((k) => k !== 'mix').sort()).toEqual([...expected].sort());
    expect(shown.includes('mix')).toBe(!!type.hasMix);
    expect(steps.map((st) => st.index)).toEqual(steps.map((_, i) => i + 1));
  }
});

test('steps follow the type', () => {
  const ids = (id) => modelSteps(ASSET_TYPES.find((t) => t.id === id)).map((st) => st.id);
  expect(ids('mf-podium')).toEqual(['site', 'use', 'zoning', 'spaces', 'buildings', 'parking', 'proforma', 'results']);
  expect(ids('industrial')).toContain('trucks');
  expect(ids('garage')).toContain('garage');
  expect(ids('garage')).not.toContain('buildings');
  expect(ids('parking')).not.toContain('buildings');
  const mf = modelSteps(ASSET_TYPES.find((t) => t.id === 'mf-podium'));
  expect(mf.find((st) => st.id === 'buildings').keys).toEqual(expect.arrayContaining(['buildingShape', 'floors', 'corridorWidth']));
  expect(mf.find((st) => st.id === 'parking').keys).toEqual(expect.arrayContaining(['parkingRatio', 'stallAngle']));
});
