// Markup for the 📸 reporter (SnapshotReporter.js): shapes are kept as a
// list and the canvas is redrawn from it, so Undo is just "drop the last
// shape". Flattened into the screenshot when the report is sent. Pure
// drawing helpers - tested in snapshotMarkup.test.js.

export const TOOLS = [
  { id: 'pen', label: 'Pen', icon: '✏️' },
  { id: 'box', label: 'Box', icon: '▭' },
  { id: 'arrow', label: 'Arrow', icon: '➜' },
  { id: 'redact', label: 'Redact', icon: '⬛', title: 'Black out private details' },
];

export const MAX_WIDTH = 1600;
export const JPEG_QUALITY = 0.85;
const COLOR = '#ff3b30';

// Scale (width, height) down to at most MAX_WIDTH wide; never up.
export function fitWithin(width, height, max = MAX_WIDTH) {
  if (width <= max) return { width, height };
  return { width: max, height: Math.round((height * max) / width) };
}

export function rectFromDrag(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

// A click without a drag shouldn't leave a speck behind.
export function isMeaningful(shape) {
  if (shape.type === 'pen') return shape.points.length > 1;
  if (shape.type === 'arrow') return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1) > 5;
  return shape.w > 4 && shape.h > 4;
}

// Line weight relative to the image, so marks look the same on a small or
// a retina-sized capture.
const lineWidthFor = (imageWidth) => Math.max(3, Math.round(imageWidth / 350));

export function drawShape(ctx, shape, imageWidth) {
  const lw = lineWidthFor(imageWidth);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (shape.type === 'redact') {
    ctx.fillStyle = '#000';
    ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.type === 'box') {
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = lw;
    ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
  } else if (shape.type === 'arrow') {
    const { x1, y1, x2, y2 } = shape;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = lw * 4;
    ctx.strokeStyle = COLOR;
    ctx.fillStyle = COLOR;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  } else if (shape.type === 'pen') {
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(shape.points[0].x, shape.points[0].y);
    for (const p of shape.points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

// The capture plus every shape, at the capture's own resolution.
export function drawAll(ctx, image, width, height, shapes) {
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  for (const shape of shapes) drawShape(ctx, shape, width);
}
