import { fitWithin, rectFromDrag, drawShape, isMeaningful, MAX_WIDTH } from './snapshotMarkup';

function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(target, prop) {
      if (prop === 'calls') return calls;
      if (prop in target) return target[prop];
      return (...args) => calls.push([prop, ...args]);
    },
    set(target, prop, value) { target[prop] = value; calls.push([`set:${prop}`, value]); return true; },
  });
  return ctx;
}

test('fitWithin: at most 1600 wide, aspect kept, never upscaled', () => {
  expect(MAX_WIDTH).toBe(1600);
  expect(fitWithin(3200, 1800)).toEqual({ width: 1600, height: 900 });
  expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 });
});

test('rectFromDrag: dragging up/left still gives a positive rect', () => {
  expect(rectFromDrag({ x: 100, y: 80 }, { x: 40, y: 20 })).toEqual({ x: 40, y: 20, w: 60, h: 60 });
});

test('isMeaningful: drops accidental clicks', () => {
  expect(isMeaningful({ type: 'box', x: 0, y: 0, w: 2, h: 40 })).toBe(false);
  expect(isMeaningful({ type: 'redact', x: 0, y: 0, w: 30, h: 30 })).toBe(true);
  expect(isMeaningful({ type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 })).toBe(false);
  expect(isMeaningful({ type: 'pen', points: [{ x: 1, y: 1 }] })).toBe(false);
  expect(isMeaningful({ type: 'pen', points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] })).toBe(true);
});

test('redact draws a solid black rectangle (no outline, fully opaque)', () => {
  const ctx = fakeCtx();
  drawShape(ctx, { type: 'redact', x: 10, y: 20, w: 100, h: 30 }, 1000);
  expect(ctx.calls).toContainEqual(['set:fillStyle', '#000']);
  expect(ctx.calls).toContainEqual(['set:globalAlpha', 1]);
  expect(ctx.calls).toContainEqual(['fillRect', 10, 20, 100, 30]);
  expect(ctx.calls.some((c) => c[0] === 'strokeRect')).toBe(false);
});

test('box strokes a rectangle; arrow draws a shaft and a head; pen follows its points', () => {
  const box = fakeCtx();
  drawShape(box, { type: 'box', x: 1, y: 2, w: 3, h: 4 }, 1000);
  expect(box.calls).toContainEqual(['strokeRect', 1, 2, 3, 4]);

  const arrow = fakeCtx();
  drawShape(arrow, { type: 'arrow', x1: 0, y1: 0, x2: 100, y2: 0 }, 1000);
  expect(arrow.calls).toContainEqual(['moveTo', 0, 0]);
  expect(arrow.calls).toContainEqual(['lineTo', 100, 0]);
  expect(arrow.calls.filter((c) => c[0] === 'fill')).toHaveLength(1); // the head

  const pen = fakeCtx();
  drawShape(pen, { type: 'pen', points: [{ x: 1, y: 1 }, { x: 5, y: 6 }, { x: 9, y: 9 }] }, 1000);
  expect(pen.calls.filter((c) => c[0] === 'lineTo')).toHaveLength(2);
});
