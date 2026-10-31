import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const source = resolve(process.env.DATABASE_PATH || './data/brightloop.sqlite');
const target = process.argv[2] && resolve(process.argv[2]);
if (!target || target === source)
  throw new Error(
    'Supply a new backup path different from the live database: node --env-file-if-exists=.env scripts/backup.mjs /path/to/backup.sqlite',
  );
await stat(source);
try {
  await stat(target);
  throw new Error('Backup destination already exists; choose a new filename.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(dirname(target), { recursive: true });
const database = new DatabaseSync(source, { readOnly: true });
try {
  await backup(database, target);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    const check = restored.prepare('PRAGMA integrity_check').get();
    if (check.integrity_check !== 'ok') throw new Error('Backup integrity check failed');
    console.log(`Backup verified: ${target}`);
  } finally {
    restored.close();
  }
} finally {
  database.close();
}
