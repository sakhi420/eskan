const fs = require('fs');
const p = 'contracts/openapi.yaml';
let c = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
let misses = 0;
const rep = (o, n, label) => { if (!c.includes(o)) { misses++; console.log('MISS: ' + label); return; } c = c.replaceAll(o, n); };

const enumsAndCore = `    PlanCode:
      type: string
      enum: [FREE, PRO, BUSINESS]
    PlanStatus:
      type: string
      enum: [DRAFT, PUBLISHED, ARCHIVED]
    PlanBillingCycle:
      type: string
      enum: [MONTHLY, YEARLY]
    SubscriptionStatus:
      type: string
      enum: [TRIALING, ACTIVE, GRACE_PERIOD, FREE, EXPIRED, SUSPENDED]
    SubscriptionAction:
      type: string
      enum: [TRIAL_STARTED, TRIAL_ENDED, PLAN_ACTIVATED, PLAN_EXTENDED, PLAN_CHANGED, PLAN_DOWNGRADED, SUSPENDED, RESUMED, GRACE_GRANTED, PAYMENT_VERIFIED]
    PlanLimits:
      type: object
      required: [advancedReports, csvExport, detailedFinance]
      properties:
        maxHostels: { type: integer, nullable: true }
        maxRooms: { type: integer, nullable: true }
        maxBeds: { type: integer, nullable: true }
        maxResidents: { type: integer, nullable: true }
        maxMembers: { type: integer, nullable: true }
        maxDevices: { type: integer, nullable: true }
        advancedReports: { type: boolean }
        csvExport: { type: boolean }
        detailedFinance: { type: boolean }
    SubscriptionPlan:
      type: object
      required: [id, version, code, name, status, currency, billingCycle, limits, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        version: { type: integer }
        code: { $ref: '#/components/schemas/PlanCode' }
        name: { type: string }
        description: { type: string }
        status: { $ref: '#/components/schemas/PlanStatus' }
        currency: { type: string, enum: [AFN] }
        priceAmount: { type: string, nullable: true }
        billingCycle: { $ref: '#/components/schemas/PlanBillingCycle' }
        limits: { $ref: '#/components/schemas/PlanLimits' }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
    SubscriptionUsage:
      type: object
      required: [hostels, residents, members, devices]
      properties:
        hostels: { type: integer }
        rooms: { type: integer }
        beds: { type: integer }
        residents: { type: integer }
        members: { type: integer }
        devices: { type: integer }
    OrganizationSubscription:
      type: object
      required: [id, organizationId, plan, status, version, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        organizationId: { type: string, format: uuid }
        plan: { $ref: '#/components/schemas/SubscriptionPlan' }
        status: { $ref: '#/components/schemas/SubscriptionStatus' }
        trialStartsAt: { type: string, format: date-time, nullable: true }
        trialEndsAt: { type: string, format: date-time, nullable: true }
        periodStartsAt: { type: string, format: date-time, nullable: true }
        periodEndsAt: { type: string, format: date-time, nullable: true }
        graceEndsAt: { type: string, format: date-time, nullable: true }
        version: { type: integer }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
    SubscriptionCurrent:
      type: object
      required: [subscription, limits, usage]
      properties:
        subscription: { $ref: '#/components/schemas/OrganizationSubscription' }
        limits: { $ref: '#/components/schemas/PlanLimits' }
        usage: { $ref: '#/components/schemas/SubscriptionUsage' }
        remainingTrialDays: { type: integer, nullable: true }
`;
rep('    HostelPage:\n', enumsAndCore + '    HostelPage:\n', 'subscription core models');
const auditAndAdmin = `    SubscriptionAuditEvent:
      type: object
      required: [id, organizationId, action, createdAt]
      properties:
        id: { type: string, format: uuid }
        organizationId: { type: string, format: uuid }
        actorUserId: { type: string, format: uuid, nullable: true }
        action: { $ref: '#/components/schemas/SubscriptionAction' }
        reason: { type: string, nullable: true }
        before: { type: object, additionalProperties: true, nullable: true }
        after: { type: object, additionalProperties: true, nullable: true }
        traceId: { type: string }
        createdAt: { type: string, format: date-time }
    SubscriptionHistoryPage:
      type: object
      required: [items, page, size, totalElements, totalPages]
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/SubscriptionAuditEvent' }
        page: { type: integer }
        size: { type: integer }
        totalElements: { type: integer }
        totalPages: { type: integer }
    ManualSubscriptionPayment:
      type: object
      required: [id, organizationId, money, method, receivedAt, verifiedByUserId, createdAt, updatedAt]
      properties:
        id: { type: string, format: uuid }
        organizationId: { type: string, format: uuid }
        subscriptionId: { type: string, format: uuid, nullable: true }
        money: { $ref: '#/components/schemas/Money' }
        method: { $ref: '#/components/schemas/PaymentMethod' }
        reference: { type: string, nullable: true }
        receivedAt: { type: string, format: date }
        verifiedByUserId: { type: string, format: uuid }
        note: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }
    PlanPage:
      type: object
      required: [items, page, size, totalElements, totalPages]
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/SubscriptionPlan' }
        page: { type: integer }
        size: { type: integer }
        totalElements: { type: integer }
        totalPages: { type: integer }
    AdminOrganizationSummary:
      type: object
      required: [id, name, createdAt]
      properties:
        id: { type: string, format: uuid }
        name: { type: string }
        email: { type: string, format: email, nullable: true }
        phone: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
    AdminOrganizationPage:
      type: object
      required: [items, page, size, totalElements, totalPages]
      properties:
        items:
          type: array
          items: { $ref: '#/components/schemas/AdminOrganizationSummary' }
        page: { type: integer }
        size: { type: integer }
        totalElements: { type: integer }
        totalPages: { type: integer }
    AdminManualPaymentRequest:
      type: object
      required: [money, method, receivedAt]
      properties:
        money: { $ref: '#/components/schemas/Money' }
        method: { $ref: '#/components/schemas/PaymentMethod' }
        reference: { type: string }
        receivedAt: { type: string, format: date }
        note: { type: string }
    AdminActivateRequest:
      type: object
      required: [planCode, periodMonths]
      properties:
        planCode: { $ref: '#/components/schemas/PlanCode' }
        periodMonths: { type: integer, minimum: 1 }
        startsAt: { type: string, format: date-time }
        reason: { type: string }
        payment: { $ref: '#/components/schemas/AdminManualPaymentRequest' }
    AdminExtendRequest:
      type: object
      required: [extensionMonths, reason]
      properties:
        extensionMonths: { type: integer, minimum: 1 }
        reason: { type: string }
    AdminChangePlanRequest:
      type: object
      required: [planCode, reason]
      properties:
        planCode: { $ref: '#/components/schemas/PlanCode' }
        reason: { type: string }
    AdminSuspendRequest:
      type: object
      required: [reason]
      properties:
        reason: { type: string }
    AdminResumeRequest:
      type: object
      required: [reason]
      properties:
        reason: { type: string }
    AdminGrantGraceRequest:
      type: object
      required: [graceDays, reason]
      properties:
        graceDays: { type: integer, minimum: 1 }
        reason: { type: string }
`;
rep('    HostelPage:\n', auditAndAdmin + '    HostelPage:\n', 'subscription audit/admin models');
fs.writeFileSync(p, c, 'utf8');
console.log('D2 done; misses=' + misses);