// Vypíše sekci jedné verze z CHANGELOG.md (formát Changesets: `## X.Y.Z` až po další `## `).
// Použití: node scripts/changelog-section.mjs <CHANGELOG.md> <verze>. Poznámky ke GitHub Release v release.yml.
import { readFileSync } from 'node:fs';

const [file, version] = process.argv.slice(2);
if (!file || !version) {
  console.error('Použití: node scripts/changelog-section.mjs <CHANGELOG.md> <verze>');
  process.exit(2);
}

const lines = readFileSync(file, 'utf8').split('\n');
const start = lines.findIndex((line) => line.trim() === `## ${version}`);
if (start === -1) {
  console.error(`V ${file} chybí sekce "## ${version}".`);
  process.exit(1);
}
const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
console.log(lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim());
