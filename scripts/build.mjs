import { readFile, writeFile, lstat, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'dist');
// Deliberate allowlist: design history, tests, CLI, docs, dotfiles and secrets are
// not deployment inputs. No recursive copy of the repository is ever performed.
const files = [
  'src/workbench-cards.js','src/interaction-cards.js','src/card-types.js','src/card-markup.js','src/card-confirmations.js',
  'src/app-error.js', 'src/api-target.js', 'src/request-transport.js', 'src/completion-evidence.js', 'src/completion-policy.js', 'src/image-evidence.js', 'src/request-outcome.js',
  'index.html', '.nojekyll',
  'src/error-diagnostic.js', 'src/transport-evidence.js', 'src/image-delivery.js', 'src/workbench.js', 'src/lifecycle.js', 'src/canvas-geometry.js', 'src/view-position.js', 'src/request-lifecycle.js', 'src/workspace-storage.js', 'src/clipboard-report.js', 'src/stream-painter.js', 'src/view-markup.js',
  'src/native-json.js', 'src/provider-identity.js',
  'src/reasoning.js', 'src/stream.js', 'src/usage.js', 'src/persistence.js', 'src/app.js', 'src/core.js', 'src/agent.js', 'src/attachments.js', 'src/icons.js', 'src/styles.css',
  'src/image-capabilities.js', 'src/logs.js', 'src/session.js', 'src/session-webmcp.js',
];
for (const file of files) {
  if (!(await lstat(join(root, file))).isFile()) throw new Error(`Expected regular production file: ${file}`);
}
// One reproducible release identity covers the whole module graph, not just app.js.
const sources = new Map(await Promise.all(files.map(async file => [file, await readFile(join(root,file))])));
const hash = createHash('sha256');
for (const file of [...files].sort()) hash.update(file).update('\0').update(sources.get(file)).update('\0');
const version = hash.digest('hex').slice(0,20);
const versionReference = reference => reference + '?v=' + version;
await rm(destination, { recursive: true, force: true });
for (const file of files) {
  const target = join(destination, file);
  await mkdir(dirname(target), { recursive: true });
  let content = sources.get(file);
  if (file.endsWith('.js')) {
    content = content.toString('utf8').replace(/((?:from|import)\s*['"])(\.[^'"]+\.js)(['"])/g,
      (_, before, reference, after) => before + versionReference(reference) + after);
  } else if (file === 'index.html') {
    content = content.toString('utf8').replace(/((?:src|href)=['"])(\.\/src\/[^'"]+\.(?:js|css))(['"])/g,
      (_, before, reference, after) => before + versionReference(reference) + after);
  }
  await writeFile(target, content);
}
process.stdout.write(`Built ${files.length} allowlisted files into dist/\n`);
