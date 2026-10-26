const fs = require('fs');
const p = 'contracts/openapi.yaml';
let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let misses = 0;
const rep = (o, n, label) => { if (!c.includes(o)) { misses++; console.log('MISS: ' + label); return; } c = c.replaceAll(o, n); };

// 1. Money -> string decimal (align with v3.0 NUMERIC(19,2) + string amount)
rep('        amount: { type: integer, minimum: 0 }',
  "        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }", 'money.amount string');

// 2. revert summary amounts integer -> string decimal
for (const f of ['totalCharged','totalPaid','allocatedBalance','unallocatedCredit','outstandingBalance','depositBalance','totalOutstanding','outstanding','totalCollected','totalDepositReceived','totalDepositRefunded','totalExpenses','openingBalance','closingBalance']) {
  rep(f + ': { type: integer }', f + ': { type: string }', 'summary ' + f);
}
rep('              amount: { type: integer }\n              balance: { type: integer }',
  '              amount: { type: string }\n              balance: { type: string }', 'statement amount');

// 3. add PLAN_LIMIT_EXCEEDED error code
rep('        - ALLOCATION_EXCEEDS_PAYMENT\n',
  '        - ALLOCATION_EXCEEDS_PAYMENT\n        - PLAN_LIMIT_EXCEEDED\n', 'plan limit code');

fs.writeFileSync(p, c, 'utf8');
console.log('D1 done; misses=' + misses);