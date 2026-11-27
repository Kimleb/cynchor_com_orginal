import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loginSchema,
  usernameSchema,
  accessRequestSchema,
  inviteTokenSchema,
  sanitizeOutput,
} from '../src/lib/validators';

test('Validators: loginSchema validates username credentials and rejects malformed inputs', () => {
  const valid = loginSchema.safeParse({
    username: 'operator',
    password: 'ValidPassword123!',
  });
  assert.equal(valid.success, true);

  const invalidUsername = loginSchema.safeParse({
    username: 'not@an#email',
    password: 'ValidPassword123!',
  });
  assert.equal(invalidUsername.success, false);

  const shortPassword = loginSchema.safeParse({
    username: 'operator',
    password: 'short',
  });
  assert.equal(shortPassword.success, false);
});

test('Validators: usernameSchema enforces lowercase 3-20 [a-z0-9_-] handles', () => {
  assert.equal(usernameSchema.safeParse('cobalt_falcon-01').success, true);
  assert.equal(usernameSchema.safeParse('ab').success, false);
  assert.equal(usernameSchema.safeParse('a'.repeat(21)).success, false);
  assert.equal(usernameSchema.safeParse('bad.handle').success, false);
});

test('Validators: accessRequestSchema enforces optional note <= 200 chars with no PII fields', () => {
  const valid = accessRequestSchema.safeParse({
    note: 'Red team lab evaluation',
  });
  assert.equal(valid.success, true);

  const emptyValid = accessRequestSchema.safeParse({});
  assert.equal(emptyValid.success, true);

  const tooLong = accessRequestSchema.safeParse({
    note: 'x'.repeat(201),
  });
  assert.equal(tooLong.success, false);
});

test('Validators: inviteTokenSchema verifies format and length', () => {
  const valid = inviteTokenSchema.safeParse({
    token: 'CYN-7A8B9C0D1E2F3A4B5C6D7E8F9A0B1C2D3E4F5A6B7C8D9E0F',
  });
  assert.equal(valid.success, true);

  const tooShort = inviteTokenSchema.safeParse({
    token: 'abc',
  });
  assert.equal(tooShort.success, false);
});

test('Validators: sanitizeOutput escapes HTML special characters', () => {
  const raw = '<img src=x onerror=alert(1)> & "quotes"';
  const sanitized = sanitizeOutput(raw);
  assert.equal(sanitized.includes('<img'), false);
  assert.equal(sanitized.includes('&lt;img'), true);
  assert.equal(sanitized.includes('&amp;'), true);
});
