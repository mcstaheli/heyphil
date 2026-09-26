import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeYield,
  classifyQuadrant,
  isOutOfMandate,
  isRightSide,
  isFlagged,
  percentCapitalInLeftHalf
} from '../../client/src/strategyGridMath.js';

test('computeYield', () => {
  assert.equal(computeYield(80000, 1000000), 0.08);
  assert.equal(computeYield(0, 1000000), 0);
  assert.equal(computeYield(50000, 0), null);
  assert.equal(computeYield(50000, null), null);
  assert.equal(computeYield(50000, undefined), null);
});

test('classifyQuadrant', () => {
  assert.equal(classifyQuadrant(12, 0.15), 'upper-left');
  assert.equal(classifyQuadrant(30, 0.15), 'upper-right');
  assert.equal(classifyQuadrant(12, 0.02), 'lower-left');
  assert.equal(classifyQuadrant(30, 0.02), 'lower-right');
  // Sitting exactly on either split line reads as "in mandate", not flagged.
  assert.equal(classifyQuadrant(24, 0.08), 'lower-left');
  assert.equal(classifyQuadrant(24, 0.15), 'upper-left');
  assert.equal(classifyQuadrant(30, 0.08), 'lower-right');
});

test('isOutOfMandate', () => {
  assert.equal(isOutOfMandate(30, 0.15), true);
  assert.equal(isOutOfMandate(30, 0.02), false);
  assert.equal(isOutOfMandate(12, 0.15), false);
  assert.equal(isOutOfMandate(12, 0.02), false);
});

test('isRightSide', () => {
  assert.equal(isRightSide(25), true);
  assert.equal(isRightSide(24), false);
  assert.equal(isRightSide(0), false);
});

test('isFlagged', () => {
  assert.equal(isFlagged(30, 'on-deck'), true);
  assert.equal(isFlagged(30, 'diligence'), true);
  assert.equal(isFlagged(30, 'assets'), false);
  assert.equal(isFlagged(12, 'on-deck'), false);
  assert.equal(isFlagged(12, 'assets'), false);
});

test('percentCapitalInLeftHalf', () => {
  const points = [
    { monthsToFirstCash: 12, capitalCommitted: 1000000 }, // left
    { monthsToFirstCash: 30, capitalCommitted: 3000000 }, // right
    { monthsToFirstCash: 6, capitalCommitted: 1000000 }   // left
  ];
  // left = 2,000,000 of 5,000,000 total = 40%
  assert.equal(percentCapitalInLeftHalf(points), 40);
  assert.equal(percentCapitalInLeftHalf([]), null);
  assert.equal(percentCapitalInLeftHalf([{ monthsToFirstCash: 12, capitalCommitted: 0 }]), null);
});
