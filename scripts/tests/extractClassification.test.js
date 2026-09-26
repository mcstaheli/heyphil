import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClassification } from '../../server/improvements-classify.js';

test('pulls kind and reasoning out of a well-formed tool_use block', () => {
  const message = {
    content: [
      { type: 'text', text: 'thinking...' },
      { type: 'tool_use', name: 'classify_report', input: { kind: 'bug', reasoning: 'The button is broken.' } },
    ],
  };
  assert.deepEqual(extractClassification(message), { kind: 'bug', reasoning: 'The button is broken.' });
});

test('defaults reasoning to empty string when omitted', () => {
  const message = { content: [{ type: 'tool_use', name: 'classify_report', input: { kind: 'feature' } }] };
  assert.deepEqual(extractClassification(message), { kind: 'feature', reasoning: '' });
});

test('returns null when there is no matching tool_use block', () => {
  assert.equal(extractClassification({ content: [{ type: 'text', text: 'no tool call' }] }), null);
  assert.equal(extractClassification({ content: [] }), null);
  assert.equal(extractClassification({}), null);
});

test('returns null when kind is missing or invalid', () => {
  const bad = { content: [{ type: 'tool_use', name: 'classify_report', input: { kind: 'not-a-kind' } }] };
  assert.equal(extractClassification(bad), null);
});
