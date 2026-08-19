// Every strict tool must list every property in `required`. One that does not
// invalidates the whole tool list, so the assistant fails on every question.
import fs from 'node:fs';
const s = fs.readFileSync('src/lib/ai/tools.ts', 'utf8');
const blocks = s.split(/\n  \{\n    type: 'function' as const,/).slice(1);
let bad = 0;
for (const b of blocks) {
  const name = b.match(/name: '([^']+)'/)?.[1] ?? '?';
  const chunk = b.slice(0, b.indexOf('\n  },'));
  const props = [...chunk.matchAll(/^\s{8}([a-z_]+): \{/gm)].map((m) => m[1]);
  const req = (chunk.match(/required: \[([^\]]*)\]/) ?? [])[1];
  if (req === undefined) {
    console.log(`  ${name}: PAS de "required"  (propriétés : ${props.join(', ') || 'aucune'})`);
    bad++;
    continue;
  }
  const listed = req.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean);
  const missing = props.filter((x) => !listed.includes(x));
  if (missing.length) {
    console.log(`  ${name}: manquantes dans required → ${missing.join(', ')}`);
    bad++;
  }
}
console.log(bad ? `\n${bad} outil(s) invalides` : `\n${blocks.length} outils, tous valides en mode strict`);
