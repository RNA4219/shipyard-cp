import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('src');
const MAX_LINES = 900;
const LEGACY_MODULE_EXCEPTIONS: Record<string, string> = {
  // Must stay synchronized with TECH_DEBT_REGISTER.md section 1.4.
  'src/store/control-plane-store.ts': '2026-09-30',
};


async function collect(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(target));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(target);
  }
  return files;
}

const violations: Array<{ file: string; lines: number }> = [];
for (const file of await collect(ROOT)) {
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/).length;
  const relative = path.relative(process.cwd(), file).split(path.sep).join('/');
  if (lines > MAX_LINES) {
    const expires = LEGACY_MODULE_EXCEPTIONS[relative];
    if (expires && new Date(`${expires}T23:59:59Z`) >= new Date()) {
      console.warn(`Core module size exception: ${relative} (${lines} lines), expires ${expires}`);
      continue;
    }
    violations.push({ file: relative, lines });
  }
}

if (violations.length > 0) {
  console.error('Core module size gate failed (max ' + MAX_LINES + ' lines):');
  for (const violation of violations) {
    console.error('- ' + violation.file + ': ' + violation.lines);
  }
  process.exitCode = 1;
} else {
  console.log('Core module size gate passed.');
}
