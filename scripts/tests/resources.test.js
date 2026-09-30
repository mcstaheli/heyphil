import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_KINDS, detectSource, resourceLayout, quickOpenLinks } from '../../client/src/resources.js';
import { RESOURCE_KIND_IDS, SINGLE_RESOURCE_KINDS, validateResourceUrl } from '../../server/resource-rules.js';

test('client and server agree on the resource kinds', () => {
  assert.deepEqual(RESOURCE_KINDS.map((k) => k.kind), RESOURCE_KIND_IDS);
  assert.deepEqual(RESOURCE_KINDS.filter((k) => k.single).map((k) => k.kind), SINGLE_RESOURCE_KINDS);
});

test('Project Folder then Working Model are the two pinned slots, in that order', () => {
  assert.deepEqual(RESOURCE_KINDS.filter((k) => k.pinned).map((k) => k.label), ['Project Folder', 'Working Model']);
});

test('detectSource: icon/caption from the URL', () => {
  assert.equal(detectSource('https://docs.google.com/spreadsheets/d/10cjEYX2/edit#gid=0').type, 'sheets');
  assert.equal(detectSource('https://drive.google.com/drive/folders/1BjGgr63M96').type, 'folder');
  assert.equal(detectSource('https://drive.google.com/drive/u/0/folders/1BjGgr63M96').type, 'folder');
  assert.equal(detectSource('https://docs.google.com/document/d/abc/edit').type, 'doc');
  assert.equal(detectSource('https://docs.google.com/presentation/d/abc/edit').type, 'slides');
  assert.equal(detectSource('https://example.com/files/Teaser.PDF').type, 'pdf');
  assert.equal(detectSource('https://drive.google.com/file/d/abc/view').type, 'file');
  assert.equal(detectSource('https://www.dropbox.com/s/x/om.docx').type, 'link');
  assert.equal(detectSource('https://docs.google.com/spreadsheets/d/x').caption, 'Google Sheets');
  assert.equal(detectSource('https://www.dropbox.com/s/x/om.docx').caption, 'dropbox.com');
  assert.equal(detectSource('not a url').type, 'link');
});

test('resourceLayout: pinned slots always present (empty or filled), extras in kind order', () => {
  const links = [
    { id: 3, kind: 'om', title: 'Offering Memorandum', url: 'https://x.com/om.pdf' },
    { id: 1, kind: 'model', title: 'Working Model', url: 'https://docs.google.com/spreadsheets/d/a' },
    { id: 4, kind: 'teaser', title: 'Teaser', url: 'https://x.com/t.pdf' },
    { id: 5, title: 'Old untyped link', url: 'https://x.com' },   // pre-Resources link -> "other"
  ];
  const { pinned, extras } = resourceLayout(links);
  assert.deepEqual(pinned.map((p) => [p.kind, p.link ? p.link.id : null]), [['folder', null], ['model', 1]]);
  assert.deepEqual(extras.map((l) => l.id), [4, 3, 5]);
});

test('quickOpenLinks: just the folder and model, for the board card icons', () => {
  const links = [
    { id: 1, kind: 'model', url: 'https://docs.google.com/spreadsheets/d/a' },
    { id: 2, kind: 'teaser', url: 'https://x.com/t.pdf' },
  ];
  assert.deepEqual(quickOpenLinks(links).map((l) => l.kind), ['model']);
  assert.deepEqual(quickOpenLinks([]), []);
  assert.deepEqual(quickOpenLinks(undefined), []);
});

test('validateResourceUrl: http(s) only - a javascript: link must never become a clickable tile', () => {
  assert.equal(validateResourceUrl('https://docs.google.com/spreadsheets/d/a'), null);
  assert.equal(validateResourceUrl('http://example.com'), null);
  assert.match(validateResourceUrl('javascript:alert(1)'), /http/);
  assert.match(validateResourceUrl('data:text/html,<script>'), /http/);
  assert.match(validateResourceUrl('not a url'), /valid/);
  assert.match(validateResourceUrl(''), /required/);
});
