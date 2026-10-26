const fs = require('fs');
const path = 'contracts/openapi.yaml';
let c = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const lines = c.split('\n');
const out = [];

let op = null; // { method, hasBody, hasPathParam, isPublic }

function collectCodes(lines, j) {
  const codes = new Set();
  while (j < lines.length) {
    const l = lines[j];
    const m = l.match(/^        '(\d{3})':/);
    if (m) { codes.add(m[1]); j++; continue; }
    if (l.startsWith('          ') || l.startsWith('        ') || l.trim() === '') { j++; continue; }
    break;
  }
  return codes;
}

let added = 0;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const om = line.match(/^    (get|post|patch|put|delete):$/);
  if (om) {
    op = { method: om[1], hasBody: false, hasPathParam: false, isPublic: false };
    out.push(line);
    continue;
  }
  if (op) {
    if (/^      security: \[\]$/.test(line)) op.isPublic = true;
    if (/^      requestBody:$/.test(line)) op.hasBody = true;
    if (line.includes('in: path')) op.hasPathParam = true;
    if (/^      responses:$/.test(line)) {
      out.push(line);
      const existing = collectCodes(lines, i + 1);
      const add = [];
      if (!op.isPublic) {
        if (!existing.has('401')) add.push("        '401': { $ref: '#/components/responses/Unauthorized' }");
        if (op.method !== 'get') {
          if (!existing.has('409')) add.push("        '409': { $ref: '#/components/responses/Conflict' }");
          if (op.hasBody && !existing.has('422')) add.push("        '422': { $ref: '#/components/responses/ValidationError' }");
        }
        if (op.hasPathParam && !existing.has('404')) add.push("        '404': { $ref: '#/components/responses/NotFound' }");
      }
      for (const a of add) { out.push(a); added++; }
      op = null;
      continue;
    }
  }
  out.push(line);
}

c = out.join('\n');
fs.writeFileSync(path, c, 'utf8');
console.log('finalize part C done; responses added=' + added);