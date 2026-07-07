// skills/update-changelog/tests/classify-bump.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyBump } from '../scripts/classify-bump.mjs';

test('patch-only bump -> патч', () => assert.equal(classifyBump('0.4.6', '0.4.7'), 'патч'));
test('minor bump -> релиз', () => assert.equal(classifyBump('0.4.7', '0.5.0'), 'релиз'));
test('major bump -> релиз', () => assert.equal(classifyBump('1.9.9', '2.0.0'), 'релиз'));
test('v-prefix tolerated', () => assert.equal(classifyBump('v1.0.0', 'v1.0.1'), 'патч'));
test('equal versions -> патч', () => assert.equal(classifyBump('1.0.0', '1.0.0'), 'патч'));
