// Local release + complete source backup. Does not upload or include credentials.
// Requires the standard zip utility; run with `npm run package` after tests.
import { access, copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'dist')
await access(resolve(dist, 'index.html'))
const backupDir = resolve(root, 'backups')
await mkdir(backupDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const publication = resolve(backupDir, `blooming-move-yandex-${stamp}.zip`)
const sources = resolve(backupDir, `blooming-move-source-${stamp}.zip`)

execFileSync('zip', ['-q', '-r', publication, '.'], { cwd: dist })
execFileSync('unzip', ['-tq', publication])
const size = (await stat(publication)).size
if (size >= 100 * 1024 * 1024) throw new Error('Publication exceeds 100 MiB.')

const sourceFiles = ['.gitignore', 'README.md', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts']
for (const dir of ['src', 'public', 'scripts', 'docs']) {
  const names = await readdir(resolve(root, dir), { recursive: true, withFileTypes: true })
  for (const entry of names) if (entry.isFile()) {
    const absolute = resolve(entry.parentPath ?? entry.path, entry.name)
    sourceFiles.push(absolute.slice(root.length + 1))
  }
}
execFileSync('zip', ['-q', sources, '-@'], { cwd: root, input: sourceFiles.sort().join('\n') + '\n' })
execFileSync('unzip', ['-tq', sources])
// The repository has one current playable ZIP; timestamped copies stay local.
await copyFile(publication, resolve(root, 'blooming-move-yandex.zip'))
console.log(JSON.stringify({ publication, sources, bytes: size, sourceFiles: sourceFiles.length }, null, 2))
