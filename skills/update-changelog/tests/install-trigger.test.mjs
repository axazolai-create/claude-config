// skills/update-changelog/tests/install-trigger.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureGitignore, ensurePostCommitHook, scaffoldConfig } from '../scripts/install-trigger.mjs';

test('ensureGitignore is idempotent', () => {
  const d = mkdtempSync(join(tmpdir(), 'it-'));
  ensureGitignore(d, ['.claude/changelog-queue']);
  ensureGitignore(d, ['.claude/changelog-queue']);
  const hits = readFileSync(join(d, '.gitignore'), 'utf8').split('\n').filter(l => l.includes('changelog-queue'));
  assert.equal(hits.length, 1);
});

test('ensurePostCommitHook preserves existing content and does not double-install', () => {
  const d = mkdtempSync(join(tmpdir(), 'it-'));
  mkdirSync(join(d, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(d, '.git', 'hooks', 'post-commit'), '#!/bin/sh\necho existing\n');
  ensurePostCommitHook(d); ensurePostCommitHook(d);
  const h = readFileSync(join(d, '.git', 'hooks', 'post-commit'), 'utf8');
  assert.match(h, /echo existing/);
  assert.equal((h.match(/changelog-trigger >>>/g) || []).length, 1);
});

test('scaffoldConfig does not overwrite an existing config', () => {
  const d = mkdtempSync(join(tmpdir(), 'it-'));
  writeFileSync(join(d, '.changelog.config.json'), '{"x":1}');
  scaffoldConfig(d, ['apps/web']);
  assert.equal(readFileSync(join(d, '.changelog.config.json'), 'utf8'), '{"x":1}');
});
