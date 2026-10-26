const fs = require('fs');
const path = 'contracts/openapi.yaml';
let c = fs.readFileSync(path, 'utf8');
c = c.replace(/\r\n/g, '\n');
let misses = 0;
const rep = (o, n, label) => {
  if (!c.includes(o)) { misses++; console.log('MISS: ' + label); return; }
  c = c.replaceAll(o, n);
};

rep('    UserSummary:\n',
  '    Money:\n      type: object\n      required: [amount, currency]\n      properties:\n        amount: { type: integer, minimum: 0 }\n        currency: { type: string, enum: [AFN] }\n    UserSummary:\n',
  'money schema');

rep('required: [hostelId, residentId, startDate, rentAmount]', 'required: [hostelId, residentId, startDate, rent]', 'contract required');
rep("        rentAmount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n        billingCycle: { type: string, enum: [MONTHLY] }\n        depositAmount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }",
  "        rent: { $ref: '#/components/schemas/Money' }\n        billingCycle: { type: string, enum: [MONTHLY] }\n        deposit: { $ref: '#/components/schemas/Money' }", 'contract fields');

rep('required: [residentId, type, amount, periodStart, periodEnd, dueDate]', 'required: [residentId, type, money, periodStart, periodEnd, dueDate]', 'charge required');
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n        periodStart",
  "        money: { $ref: '#/components/schemas/Money' }\n        periodStart", 'charge field');

rep('required: [chargeId, amount]', 'required: [chargeId, money]', 'alloc-request required');
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n    PaymentRequest:",
  "        money: { $ref: '#/components/schemas/Money' }\n    PaymentRequest:", 'alloc-request field');

rep('required: [residentId, amount, method, receivedAt, receiptNumber]', 'required: [residentId, money, method, receivedAt, receiptNumber]', 'payment required');
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n        method",
  "        money: { $ref: '#/components/schemas/Money' }\n        method", 'payment field');

rep('required: [type, amount]', 'required: [type, money]', 'deposit required');
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n        receivedAt",
  "        money: { $ref: '#/components/schemas/Money' }\n        receivedAt", 'deposit field');

rep('required: [category, amount, spentAt]', 'required: [category, money, spentAt]', 'expense required');
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }\n        currency: { type: string, enum: [AFN] }\n        spentAt",
  "        money: { $ref: '#/components/schemas/Money' }\n        spentAt", 'expense field');

rep('startDate, rentAmount, currency, billingCycle, createdAt', 'startDate, rent, billingCycle, createdAt', 'contract resp required');
rep("        rentAmount: { type: string }\n        currency: { type: string }\n        billingCycle: { type: string }\n        depositAmount: { type: string }",
  "        rent: { $ref: '#/components/schemas/Money' }\n        billingCycle: { type: string }\n        deposit: { $ref: '#/components/schemas/Money' }", 'contract resp fields');

rep('type, status, amount, currency, periodStart', 'type, status, money, periodStart', 'charge resp required');
rep("        amount: { type: string }\n        currency: { type: string }\n        periodStart",
  "        money: { $ref: '#/components/schemas/Money' }\n        periodStart", 'charge resp field');

rep('required: [id, paymentId, chargeId, amount, createdAt]', 'required: [id, paymentId, chargeId, money, createdAt]', 'alloc resp required');
rep("        amount: { type: string }\n        createdAt", "        money: { $ref: '#/components/schemas/Money' }\n        createdAt", 'alloc resp field');

rep('status, amount, currency, method, receivedAt', 'status, money, method, receivedAt', 'payment resp required');
rep("        amount: { type: string }\n        currency: { type: string }\n        method", "        money: { $ref: '#/components/schemas/Money' }\n        method", 'payment resp field');

rep('type, status, amount, currency, createdAt', 'type, status, money, createdAt', 'deposit resp required');
rep("        amount: { type: string }\n        currency: { type: string }\n        receivedAt", "        money: { $ref: '#/components/schemas/Money' }\n        receivedAt", 'deposit resp field');

rep('category, status, amount, currency, spentAt', 'category, status, money, spentAt', 'expense resp required');
rep("        amount: { type: string }\n        currency: { type: string }\n        spentAt", "        money: { $ref: '#/components/schemas/Money' }\n        spentAt", 'expense resp field');
// ---- summary amounts string -> integer ----
for (const f of ['totalCharged','totalPaid','allocatedBalance','unallocatedCredit','outstandingBalance','depositBalance','totalOutstanding','outstanding','totalCollected','totalDepositReceived','totalDepositRefunded','totalExpenses','openingBalance','closingBalance']) {
  rep(f + ': { type: string }', f + ': { type: integer }', 'summary ' + f);
}
rep("              amount: { type: string }\n              balance: { type: string }",
  "              amount: { type: integer }\n              balance: { type: integer }", 'statement amounts');

// ---- multi-org ----
rep('required: [accessToken, refreshToken, expiresIn, user, organizationId]', 'required: [accessToken, refreshToken, expiresIn, user, memberships]', 'authsession required');
rep('        organizationId: { type: string, format: uuid }',
  '        memberships:\n          type: array\n          items: { $ref: \'#/components/schemas/MembershipSummary\' }', 'authsession memberships');
rep('    Membership:\n',
  '    MembershipSummary:\n      type: object\n      required: [organizationId, organizationName, role, active]\n      properties:\n        membershipId: { type: string, format: uuid }\n        organizationId: { type: string, format: uuid }\n        organizationName: { type: string }\n        role: { $ref: \'#/components/schemas/Role\' }\n        active: { type: boolean }\n    Membership:\n', 'membership summary');

fs.writeFileSync(path, c, 'utf8');
console.log('finalize part A done; misses=' + misses);
// __PART_B__