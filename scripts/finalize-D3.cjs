const fs = require('fs');
const p = 'contracts/openapi.yaml';
let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let misses = 0;
const rep = (o, n, label) => { if (!c.includes(o)) { misses++; console.log('MISS: ' + label); return; } c = c.replaceAll(o, n); };

// version + tags
rep('  version: 0.2.0', '  version: 0.3.0', 'version');
rep('  - name: sync\n    description: offline-first synchronization\n',
  '  - name: sync\n    description: offline-first synchronization\n  - name: subscriptions\n    description: subscription plans, trial and entitlements\n  - name: platform-admin\n    description: platform admin subscription management\n', 'tags');

const pathsA = `  /api/v1/plans:
    get:
      tags: [subscriptions]
      summary: list published subscription plans
      operationId: planList
      security: []
      responses:
        '200':
          description: published plans
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/PlanPage' }
                  meta: { $ref: '#/components/schemas/Meta' }
  /api/v1/subscription/current:
    get:
      tags: [subscriptions]
      summary: effective subscription and entitlements of the active organization
      operationId: subscriptionGetCurrent
      responses:
        '200':
          description: current subscription
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/SubscriptionCurrent' }
                  meta: { $ref: '#/components/schemas/Meta' }
  /api/v1/subscription/history:
    get:
      tags: [subscriptions]
      summary: subscription change history for the active organization
      operationId: subscriptionHistory
      parameters:
        - { name: page, in: query, required: false, schema: { type: integer, default: 1 } }
        - { name: size, in: query, required: false, schema: { type: integer, default: 20 } }
      responses:
        '200':
          description: history
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/SubscriptionHistoryPage' }
                  meta: { $ref: '#/components/schemas/Meta' }
  /api/v1/admin/organizations:
    get:
      tags: [platform-admin]
      summary: list organizations (platform admin only)
      operationId: adminOrganizationList
      description: requires PLATFORM_ADMIN system-level role
      parameters:
        - { name: page, in: query, required: false, schema: { type: integer, default: 1 } }
        - { name: size, in: query, required: false, schema: { type: integer, default: 20 } }
        - { name: q, in: query, required: false, schema: { type: string } }
      responses:
        '200':
          description: organizations
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/AdminOrganizationPage' }
                  meta: { $ref: '#/components/schemas/Meta' }
  /api/v1/admin/organizations/{organizationId}/subscription:
    get:
      tags: [platform-admin]
      summary: view an organization subscription (platform admin only)
      operationId: adminSubscriptionGet
      description: requires PLATFORM_ADMIN system-level role
      parameters:
        - { name: organizationId, in: path, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: subscription
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/SubscriptionCurrent' }
                  meta: { $ref: '#/components/schemas/Meta' }
  /api/v1/admin/organizations/{organizationId}/subscription/history:
    get:
      tags: [platform-admin]
      summary: view an organization subscription history (platform admin only)
      operationId: adminSubscriptionHistory
      description: requires PLATFORM_ADMIN system-level role
      parameters:
        - { name: organizationId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: page, in: query, required: false, schema: { type: integer, default: 1 } }
        - { name: size, in: query, required: false, schema: { type: integer, default: 20 } }
      responses:
        '200':
          description: history
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/SubscriptionHistoryPage' }
                  meta: { $ref: '#/components/schemas/Meta' }
`;
c = c.replace('components:\n', pathsA + 'components:\n');
fs.writeFileSync(p, c, 'utf8');
console.log('D3 part A done; misses=' + misses);
function okResponse(desc, ref) {
  return `        '200':
          description: ${desc}
          content:
            application/json:
              schema:
                type: object
                required: [data, meta]
                properties:
                  data: { $ref: '#/components/schemas/${ref}' }
                  meta: { $ref: '#/components/schemas/Meta' }`;
}

function mutation(opId, subPath, summary, requestRef, idem, ref) {
  const idemParam = idem ? "        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, format: uuid } }\n" : "";
  return `  /api/v1/admin/organizations/{organizationId}/subscription/${subPath}:
    post:
      tags: [platform-admin]
      summary: ${summary} (platform admin only)
      operationId: ${opId}
      description: requires PLATFORM_ADMIN system-level role
      parameters:
        - { name: organizationId, in: path, required: true, schema: { type: string, format: uuid } }
${idemParam}      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${requestRef}' }
      responses:
${okResponse('subscription updated', ref)}
`;
}

const admins =
  mutation('adminSubscriptionActivate', 'activate', 'activate a paid plan after manual verification', 'AdminActivateRequest', true, 'OrganizationSubscription') +
  mutation('adminSubscriptionExtend', 'extend', 'extend a paid period', 'AdminExtendRequest', false, 'OrganizationSubscription') +
  mutation('adminSubscriptionChangePlan', 'change-plan', 'change an organization plan', 'AdminChangePlanRequest', false, 'OrganizationSubscription') +
  mutation('adminSubscriptionSuspend', 'suspend', 'suspend a subscription', 'AdminSuspendRequest', false, 'OrganizationSubscription') +
  mutation('adminSubscriptionResume', 'resume', 'resume a suspended subscription', 'AdminResumeRequest', false, 'OrganizationSubscription') +
  mutation('adminSubscriptionGrantGrace', 'grant-grace', 'grant a grace period', 'AdminGrantGraceRequest', false, 'OrganizationSubscription');

const payments = `  /api/v1/admin/organizations/{organizationId}/subscription/payments:
    post:
      tags: [platform-admin]
      summary: record a verified manual subscription payment (platform admin only)
      operationId: adminSubscriptionPayment
      description: requires PLATFORM_ADMIN system-level role; records an out-of-band verified payment
      parameters:
        - { name: organizationId, in: path, required: true, schema: { type: string, format: uuid } }
        - { name: Idempotency-Key, in: header, required: true, schema: { type: string, format: uuid } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AdminManualPaymentRequest' }
      responses:
${okResponse('payment recorded', 'ManualSubscriptionPayment')}
`;

c = c.replace('components:\n', admins + payments + 'components:\n');
fs.writeFileSync(p, c, 'utf8');
console.log('D3 part B done; misses=' + misses);