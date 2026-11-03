#!/usr/bin/env node
/** One canonical SQL source; edge embedding is generated, never edited independently. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const directory=new URL('database/migrations/',root);
const files=(await fs.readdir(directory)).filter(name=>/^\d{4}_[a-zA-Z0-9_]+\.sql$/.test(name)).sort();
const versions=new Set<string>();
let output='// Auto-generated embedded migrations for edge runtimes (Cloudflare Workers)\nexport interface EmbeddedMigration {\n  version: string;\n  name: string;\n  sql: string;\n}\n\nexport const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [\n';
for(const name of files){
  const version=name.slice(0,4);if(versions.has(version))throw new Error(`Duplicate migration version ${version}`);versions.add(version);
  output+=`  {\n    version: ${JSON.stringify(version)},\n    name: ${JSON.stringify(name)},\n    sql: ${JSON.stringify(await fs.readFile(new URL(name,directory),'utf8'))},\n  },\n`;
}
output+='];\n';
const target=new URL('apps/api/src/adapters/embedded-migrations.ts',root);
if(process.argv.includes('--check')){
  if(await fs.readFile(target,'utf8')!==output)throw new Error('Embedded migrations are stale. Run npm run migrations:embed and review the diff.');
}else await fs.writeFile(target,output);
console.log(`${files.length} embedded SQL migrations ${process.argv.includes('--check')?'match':'generated'} (${fileURLToPath(target)})`);
