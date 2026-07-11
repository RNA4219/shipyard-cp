import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = [path.resolve('docs'), path.resolve('.')];
const today = new Date(process.env.DOC_FRESHNESS_TODAY ?? new Date().toISOString().slice(0, 10));
const seen = new Set<string>();
const overdue: Array<{ file: string; due: string }> = [];

async function collect(directory: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() && recursive && !entry.name.startsWith('.')) files.push(...await collect(target, true));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(target);
  }
  return files;
}

for (const root of roots) {
  const recursive = path.basename(root) === 'docs';
  for (const file of await collect(root, recursive)) {
    if (seen.has(file)) continue;
    seen.add(file);
    const content = await readFile(file, 'utf8');
    if (!content.startsWith('---')) continue;
    const end = content.indexOf('\n---', 3);
    if (end < 0) continue;
    const frontmatter = content.slice(3, end);
    const status = /^status:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim();
    const due = /^next_review_due:\s*(\d{4}-\d{2}-\d{2})$/m.exec(frontmatter)?.[1];
    if (status === 'active' && due && new Date(due + 'T23:59:59Z') < today) {
      overdue.push({ file: path.relative(process.cwd(), file), due });
    }
  }
}

if (overdue.length > 0) {
  console.error('Documentation freshness gate failed:');
  for (const item of overdue) console.error('- ' + item.file + ' (due ' + item.due + ')');
  process.exitCode = 1;
} else {
  console.log('Documentation freshness gate passed.');
}
