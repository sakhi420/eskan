const fs = require('fs');
const path = 'contracts/openapi.yaml';
let c = fs.readFileSync(path, 'utf8');
c = c.replace(/\r\n/g, '\n');

// tag descriptions
const tags = [
  ['system', 'health and service metadata'],
  ['auth', 'authentication and session management'],
  ['organizations', 'organization profile and memberships'],
  ['hostels', 'hostels master data'],
  ['rooms', 'rooms of a hostel'],
  ['beds', 'beds of a room'],
  ['residents', 'residents and their accounts'],
  ['contracts', 'stay contracts'],
  ['bed-assignments', 'bed assignment lifecycle'],
  ['charges', 'charges (billed obligations)'],
  ['payments', 'payments and allocations'],
  ['deposits', 'deposit / security transactions'],
  ['expenses', 'paid expenses'],
  ['reports', 'dashboard and financial reports'],
  ['sync', 'offline-first synchronization'],
];
for (const [name, desc] of tags) {
  c = c.replace('  - name: ' + name + '\n', '  - name: ' + name + '\n    description: ' + desc + '\n');
}

// remove dead schemas
const pageBlock = '    Page:\n      type: object\n      required: [items, page, size, totalElements, totalPages]\n      properties:\n        items: { type: array, items: {} }\n        page: { type: integer }\n        size: { type: integer }\n        totalElements: { type: integer }\n        totalPages: { type: integer }\n';
c = c.replace(pageBlock, '');
const moneyBlock = "    Money:\n      type: object\n      required: [amount, currency]\n      properties:\n        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n";
c = c.replace(moneyBlock, '');

fs.writeFileSync(path, c, 'utf8');
console.log('done');