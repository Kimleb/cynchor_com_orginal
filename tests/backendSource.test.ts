import test from 'node:test';
import assert from 'node:assert/strict';
import { accessRequestSchema } from '../src/lib/validators';
import { getDb } from '../src/lib/db';

test('Backend: accessRequestSchema accepts source pilot and demo, rejects others', () => {
  const pilotValid = accessRequestSchema.safeParse({
    note: 'University cohort pilot',
    source: 'pilot',
  });
  assert.equal(pilotValid.success, true);
  if (pilotValid.success) {
    assert.equal(pilotValid.data.source, 'pilot');
  }

  const demoValid = accessRequestSchema.safeParse({
    note: 'Demo evaluation',
    source: 'demo',
  });
  assert.equal(demoValid.success, true);

  const defaultSource = accessRequestSchema.safeParse({
    note: 'Default source',
  });
  assert.equal(defaultSource.success, true);
  if (defaultSource.success) {
    assert.equal(defaultSource.data.source, 'demo');
  }

  const invalidSource = accessRequestSchema.safeParse({
    note: 'Invalid source',
    source: 'other_unknown_source',
  });
  assert.equal(invalidSource.success, false);
});

test('Backend: honeypot website field rejects non-empty values', () => {
  const emptyHoneypot = accessRequestSchema.safeParse({
    note: 'Real human',
    website: '',
  });
  assert.equal(emptyHoneypot.success, true);

  const spamBot = accessRequestSchema.safeParse({
    note: 'Spam bot',
    website: 'https://spammy-site.invalid',
  });
  assert.equal(spamBot.success, false);
});

test('Backend: access_requests table has source and note columns in database', async () => {
  const db = getDb();
  const cols = (await db.prepare('PRAGMA table_info(access_requests)').all()) as Array<{ name: string }>;
  assert.equal(cols.some((c) => c.name === 'source'), true);
  assert.equal(cols.some((c) => c.name === 'note'), true);
});
