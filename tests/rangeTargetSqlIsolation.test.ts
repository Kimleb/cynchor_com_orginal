import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
// Built by concatenation so this file never matches its own scan.
const MARKER = 'DELIBERATELY-VULNERABLE' + '-SQL';

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('the deliberate SQLi marker exists only inside range-target/', () => {
  const hits = [...walk(root)].filter((f) => !f.includes(`${path.sep}.next${path.sep}`) && !f.includes(`${path.sep}.tools${path.sep}`))
    .filter((f) => fs.readFileSync(f, 'utf8').includes(MARKER))
    .map((f) => path.relative(root, f));
  assert.deepEqual(hits, ['range-target/server.js']);
});

test('main app src/ has no concatenated or interpolated SQL', () => {
  const sqlVerb = /\b(SELECT\b.*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/;
  const offenders: string[] = [];
  for (const f of walk(path.join(root, 'src'))) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!sqlVerb.test(line)) return;
      // This fixed migration copies quoted schema identifiers, never request values.
      if (path.relative(root, f) === path.join('src', 'lib', 'account-schema.ts')
        && line.trim() === "db.exec(`INSERT INTO ${quoteIdentifier('new_' + table)} (${shared}) SELECT ${shared} FROM ${quoteIdentifier(table)}`);") return;
      const concat = /['"`]\s*\+\s*(req|body|params|input|user|\w*\.\w+)/.test(line) || /\+\s*req\./.test(line);
      const interp = /`[^`]*(SELECT\b.*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)[^`]*\$\{/.test(line);
      if (concat || interp) offenders.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
