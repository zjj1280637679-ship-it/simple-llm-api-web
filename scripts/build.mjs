import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'dist');
// Deliberate allowlist: design history, tests, CLI, docs, dotfiles and secrets are
// not deployment inputs. No recursive copy of the repository is ever performed.
const files = [
  'index.html', '.nojekyll',
  'src/app.js', 'src/core.js', 'src/agent.js', 'src/icons.js', 'src/styles.css',
];
for (const file of files) {
  if (!(await lstat(join(root, file))).isFile()) throw new Error(`Expected regular production file: ${file}`);
}
await rm(destination, { recursive: true, force: true });
for (const file of files) {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, file), target);
}
process.stdout.write(`Built ${files.length} allowlisted files into dist/\n`);
