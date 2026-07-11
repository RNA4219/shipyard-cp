import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('src');
const MAX_LINES = 900;

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
  if (lines > MAX_LINES) {
    violations.push({ file: path.relative(process.cwd(), file), lines });
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
