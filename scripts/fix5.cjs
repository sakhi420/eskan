const fs = require('fs');
const p = 'contracts/openapi.yaml';
let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
c = c.replaceAll("'429': { $ref: '#/components/responses/Error' }", "'429': { $ref: '#/components/responses/RateLimited' }");
c = c.replaceAll("'403': { $ref: '#/components/responses/Error' }", "'403': { $ref: '#/components/responses/Forbidden' }");
fs.writeFileSync(p, c, 'utf8');
console.log('wired Forbidden + RateLimited');