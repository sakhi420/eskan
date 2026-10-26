const fs = require('fs');
const path = 'contracts/openapi.yaml';
let c = fs.readFileSync(path, 'utf8');

// 1. license
c = c.replace('    name: ESKAN Engineering\nservers:', '    name: ESKAN Engineering\n  license:\n    name: Proprietary\nservers:');

// 2. LedgerEntryStatus
c = c.replaceAll('#/components/schemas/ChargeStatus', '#/components/schemas/LedgerEntryStatus');
c = c.replaceAll('    ChargeStatus:\n', '    LedgerEntryStatus:\n');

// 3. Idempotency-Key required
c = c.replaceAll('Idempotency-Key, in: header, required: false', 'Idempotency-Key, in: header, required: true');
c = c.replaceAll('          name: Idempotency-Key\n          required: false', '          name: Idempotency-Key\n          required: true');

// 4. If-Match -> X-Expected-Version
c = c.replaceAll('name: If-Match', 'name: X-Expected-Version');

// 5. typed pagination
const pageMap = { hostelList: 'HostelPage', roomList: 'RoomPage', bedList: 'BedPage', residentList: 'ResidentPage', contractList: 'ContractPage', chargeList: 'ChargePage', paymentList: 'PaymentPage', expenseList: 'ExpensePage' };
let currentOp = null;
const lines = c.split('\n');
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^      operationId: (\w+)$/);
  if (m) currentOp = m[1];
  if (lines[i].includes("#/components/schemas/Page'")) {
    if (currentOp && pageMap[currentOp]) lines[i] = lines[i].replace('#/components/schemas/Page', '#/components/schemas/' + pageMap[currentOp]);
  }
}
c = lines.join('\n');

// 6. typed page schemas
const entityForPage = { HostelPage: 'Hostel', RoomPage: 'Room', BedPage: 'Bed', ResidentPage: 'Resident', ContractPage: 'StayContract', ChargePage: 'Charge', PaymentPage: 'Payment', ExpensePage: 'Expense' };
let pageSchemas = '';
for (const pg of Object.keys(entityForPage)) {
  const ent = entityForPage[pg];
  pageSchemas += '    ' + pg + ':\n      type: object\n      required: [items, page, size, totalElements, totalPages]\n      properties:\n        items:\n          type: array\n          items: { $ref: \'#/components/schemas/' + ent + '\' }\n        page: { type: integer }\n        size: { type: integer }\n        totalElements: { type: integer }\n        totalPages: { type: integer }\n';
}
c = c.replace('    Money:\n', pageSchemas + '    Money:\n');
// 7. add Idempotency-Key to reversal endpoints
const rev = (p) => '      parameters: [{ name: ' + p + ', in: path, required: true, schema: { type: string, format: uuid } }]\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: \'#/components/schemas/ReversalRequest\' }';
const revNew = (p) => '      parameters:\n        - { name: ' + p + ', in: path, required: true, schema: { type: string, format: uuid } }\n        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, format: uuid } }\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: \'#/components/schemas/ReversalRequest\' }';
for (const p of ['chargeId', 'paymentId', 'depositTransactionId', 'expenseId']) c = c.replace(rev(p), revNew(p));

// 8. sync operations endpoint
const syncOpsPath = '  /api/v1/sync/operations:\n    post:\n      tags: [sync]\n      summary: submit queued offline mutations for processing\n      operationId: syncSubmitOperations\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: \'#/components/schemas/SyncOperationsRequest\' }\n      responses:\n        \'200\':\n          description: per-operation results\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [data, meta]\n                properties:\n                  data: { $ref: \'#/components/schemas/SyncOperationsResponse\' }\n                  meta: { $ref: \'#/components/schemas/Meta\' }\n        \'422\': { $ref: \'#/components/responses/Error\' }\ncomponents:\n';
c = c.replace('components:\n', syncOpsPath);

// 9. sync operation schemas
const syncSchemas = '    SyncOperation:\n      type: object\n      required: [operationId, entityType, action, payload, baseVersion]\n      properties:\n        operationId: { type: string, format: uuid }\n        entityType: { type: string }\n        action: { type: string, enum: [CREATE, UPDATE, ARCHIVE, REVERSE] }\n        payload: { type: object }\n        baseVersion: { type: integer }\n        idempotencyKey: { type: string, format: uuid }\n    SyncOperationsRequest:\n      type: object\n      required: [operations]\n      properties:\n        operations:\n          type: array\n          items: { $ref: \'#/components/schemas/SyncOperation\' }\n    SyncOperationResult:\n      type: object\n      required: [operationId, status]\n      properties:\n        operationId: { type: string, format: uuid }\n        status: { $ref: \'#/components/schemas/SyncOperationStatus\' }\n        entityId: { type: string, format: uuid }\n        entityVersion: { type: integer }\n        errorCode: { type: string }\n        message: { type: string }\n    SyncOperationsResponse:\n      type: object\n      required: [results, appliedCount, conflictCount]\n      properties:\n        results:\n          type: array\n          items: { $ref: \'#/components/schemas/SyncOperationResult\' }\n        appliedCount: { type: integer }\n        conflictCount: { type: integer }\n';
c = c.replace('    SyncDevice:\n', syncSchemas + '    SyncDevice:\n');

fs.writeFileSync(path, c, 'utf8');
console.log('contract updated');