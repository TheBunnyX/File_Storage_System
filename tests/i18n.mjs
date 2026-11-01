import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const keys=new Set();
for(const file of ['components/preferences.tsx','lib/translations.ts']){
 const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=node=>{if(ts.isPropertyAssignment(node)&&(ts.isStringLiteral(node.name)||ts.isIdentifier(node.name)))keys.add(node.name.text);ts.forEachChild(node,visit)};visit(tree);
}
const invariant=new Set(['%','+','.','.env.example','.env.local','/',':','Ctrl / ⌘ K','Esc','NexaFile','Sarah Chen','colleague@example.com','v.2.0','you@example.com','·','ภาษาไทย','“','”']);
const missing=[],unwrapped=[];let lookups=0;
function literalBranches(node){if(ts.isStringLiteral(node))return[node.text];if(ts.isConditionalExpression(node))return [...literalBranches(node.whenTrue),...literalBranches(node.whenFalse)];return[]}
for(const file of fs.readdirSync('components').filter(f=>f.endsWith('.tsx')&&!['preferences.tsx','brand-icon.tsx'].includes(f)).map(f=>'components/'+f).concat(['app/page.tsx'])){
 const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const visit=node=>{
  if(ts.isCallExpression(node)&&node.expression.getText(tree)==='t'&&node.arguments[0])for(const value of literalBranches(node.arguments[0])){lookups++;if(!keys.has(value)&&!invariant.has(value))missing.push(`${file}: ${value}`)}
  if(ts.isJsxText(node)&&/[a-zA-Z]/.test(node.text))unwrapped.push(`${file}: ${node.text.trim()}`);
  ts.forEachChild(node,visit);
 };visit(tree);
}
assert.deepEqual([...new Set(missing)],[],'Every literal UI lookup needs a Thai translation or explicit invariant');
assert.deepEqual(unwrapped,[],'UI copy must use the locale translator');
assert.ok(lookups>200,'Coverage scans the actual interface');
console.log(`PASS: localization coverage for ${lookups} UI lookups. No untranslated literal copy found (technical names explicitly allowed).`);
