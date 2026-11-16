import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanName } from './names.ts';

test('a typed name keeps its letters, digits and single spaces', () => {
  assert.equal(cleanName('  Rohan  55 '), 'Rohan 55');
  assert.equal(cleanName("O'Neil-Sara"), "O'Neil-Sara");
  assert.equal(cleanName('मीरा'), 'मीरा');
});

test('markup, emoji and overlong names are cut down', () => {
  assert.equal(cleanName('<b>Kai</b>'), 'bKaib');
  assert.equal(cleanName('Zoya🎉'), 'Zoya');
  assert.equal(cleanName('A'.repeat(40)).length, 16);
});

test('blocked names come back empty, innocent look-alikes do not', () => {
  assert.equal(cleanName('sh1t head'), '');
  assert.equal(cleanName('F.u.c.k'), '');
  assert.equal(cleanName('ass'), '');
  assert.equal(cleanName('Cassie'), 'Cassie');
  assert.equal(cleanName('Grape'), 'Grape');
  assert.equal(cleanName(''), '');
  assert.equal(cleanName(undefined), '');
});
