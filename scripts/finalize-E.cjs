const fs = require('fs');
const p = 'contracts/openapi.yaml';
let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let misses = 0;
const rep = (o, n, label) => { if (!c.includes(o)) { misses++; console.log('MISS: ' + label); return; } c = c.replaceAll(o, n); };

// 1. Money.amount -> integer (A-016)
rep("        amount: { type: string, pattern: '^\\d+(\\.\\d{1,2})?$' }",
  '        amount: { type: integer, minimum: 0 }', 'money amount integer');

// 2. priceAmount -> integer nullable
rep('priceAmount: { type: string, nullable: true }', 'priceAmount: { type: integer, nullable: true }', 'priceAmount integer');

// 3. summary amounts string -> integer (A-016)
for (const f of ['totalCharged','totalPaid','allocatedBalance','unallocatedCredit','outstandingBalance','depositBalance','totalOutstanding','outstanding','totalCollected','totalDepositReceived','totalDepositRefunded','totalExpenses','openingBalance','closingBalance']) {
  rep(f + ': { type: string }', f + ': { type: integer }', 'summary ' + f);
}

// 4. statement item amount/balance -> integer
rep('              amount: { type: string }\n              balance: { type: string }',
  '              amount: { type: integer }\n              balance: { type: integer }', 'statement amount integer');

// 5. remove /sync/operations path
rep('  /api/v1/sync/operations:\n    post:\n      tags: [sync]\n      summary: submit queued offline mutations for processing\n      operationId: syncSubmitOperations\n      requestBody:\n        required: true\n        content:\n          application/json:\n            schema: { $ref: \'#/components/schemas/SyncOperationsRequest\' }\n      responses:\n        \'401\': { $ref: \'#/components/responses/Unauthorized\' }\n        \'409\': { $ref: \'#/components/responses/Conflict\' }\n        \'200\':\n          description: per-operation results\n          content:\n            application/json:\n              schema:\n                type: object\n                required: [data, meta]\n                properties:\n                  data: { $ref: \'#/components/schemas/SyncOperationsResponse\' }\n                  meta: { $ref: \'#/components/schemas/Meta\' }\n        \'422\': { $ref: \'#/components/responses/Error\' }\n',
  '', 'remove sync/operations path');

// 6. remove sync operation schemas + enum
rep("    SyncOperationStatus:\n      type: string\n      enum: [APPLIED, DUPLICATE, CONFLICT, VALIDATION_FAILED, FORBIDDEN, RETRYABLE_FAILURE]\n",
  '', 'remove SyncOperationStatus');
rep("    SyncOperation:\n      type: object\n      required: [operationId, entityType, action, payload, baseVersion]\n      properties:\n        operationId: { type: string, format: uuid }\n        entityType: { type: string }\n        action: { type: string, enum: [CREATE, UPDATE, ARCHIVE, REVERSE] }\n        payload: { type: object }\n        baseVersion: { type: integer }\n        idempotencyKey: { type: string, format: uuid }\n    SyncOperationsRequest:\n      type: object\n      required: [operations]\n      properties:\n        operations:\n          type: array\n          items: { $ref: '#/components/schemas/SyncOperation' }\n    SyncOperationResult:\n      type: object\n      required: [operationId, status]\n      properties:\n        operationId: { type: string, format: uuid }\n        status: { $ref: '#/components/schemas/SyncOperationStatus' }\n        entityId: { type: string, format: uuid }\n        entityVersion: { type: integer }\n        errorCode: { type: string }\n        message: { type: string }\n    SyncOperationsResponse:\n      type: object\n      required: [results, appliedCount, conflictCount]\n      properties:\n        results:\n          type: array\n          items: { $ref: '#/components/schemas/SyncOperationResult' }\n        appliedCount: { type: integer }\n        conflictCount: { type: integer }\n",
  '', 'remove sync operation schemas');

fs.writeFileSync(p, c, 'utf8');
console.log('finalize-E done; misses=' + misses);