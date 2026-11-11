import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { APP_GROUPS, APP_KEYS, SEED_APPS, isAppKey } from '../../server/app-catalog.js';

test('client and server app catalogs list the same apps under the same headings', () => {
  const src = fs.readFileSync(new URL('../../client/src/appCatalog.js', import.meta.url), 'utf8');
  const clientGroups = [...src.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(clientGroups, APP_GROUPS.map((g) => g.id));
  const clientKeys = [...src.matchAll(/\{ key: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(clientKeys, APP_KEYS);
});

test('every gated route key and the seed apps are real app keys', () => {
  SEED_APPS.forEach((k) => assert.ok(isAppKey(k), k));
  for (const [file, key] of [['modeling.js', 'modeling'], ['design.js', 'design'], ['site-plans.js', 'site-planner'], ['cashflow.js', 'cashflow']]) {
    const s = fs.readFileSync(new URL(`../../server/routes/${file}`, import.meta.url), 'utf8');
    assert.match(s, new RegExp(`requireAppAccess\\('${key}'\\)`), file);
    assert.ok(isAppKey(key));
  }
  assert.equal(isAppKey('nope'), false);
});

test('every app route in App.js is wrapped in a Gate for its own app', () => {
  const app = fs.readFileSync(new URL('../../client/src/App.js', import.meta.url), 'utf8');
  const src = fs.readFileSync(new URL('../../client/src/appCatalog.js', import.meta.url), 'utf8');
  for (const m of src.matchAll(/\{ key: '([^']+)', path: '([^']+)'/g)) {
    const [, key, path] = m;
    assert.match(app, new RegExp(`<Route path="${path}" element=\\{<Gate app="${key}">`), `${path} gated as ${key}`);
  }
});
