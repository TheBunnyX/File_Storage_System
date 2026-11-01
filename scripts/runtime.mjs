import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
export async function serverRuntime() {
  await mkdir('.test-data', { recursive: true });
  const target = await mkdtemp(path.resolve('.test-data/server-runtime-'));
  for (const name of (await readdir('lib')).filter(name => name.endsWith('.ts'))) {
    const source = await readFile(path.join('lib', name), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    await writeFile(path.join(target, name.replace(/\.ts$/, '.js')), code);
  }
  return createRequire(path.join(target, 'runtime.js'));
}
