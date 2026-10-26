const fs = require('fs');
const p = 'contracts/openapi.yaml';
const raw = fs.readFileSync(p, 'utf8');
const lines = raw.split('\n');

// sanity checks (1-indexed -> 0-indexed)
const l2757 = lines[2756]; // expect: '        deviceId: { type: string } }'
const l2758 = lines[2757]; // expect: '        currency: { type: string, enum: [AFN] }'
console.log('l2757 =', JSON.stringify(l2757));
console.log('l2758 =', JSON.stringify(l2758));

if (!/ \}$/.test(l2757)) throw new Error('line 2757 unexpected');
if (!l2758.includes('currency')) throw new Error('line 2758 unexpected');

// fix the stray " }" on the last kept line
lines[2756] = l2757.replace(/ \}$/, '');
// keep lines 1..2757 (indices 0..2756), drop duplicate copy B (indices 2757..end)
const kept = lines.slice(0, 2757);
fs.writeFileSync(p, kept.join('\n') + '\n', 'utf8');
console.log('recovered OK; lines now =', kept.length);