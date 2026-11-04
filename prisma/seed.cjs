require('dotenv/config');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('../dist/generated/prisma/client');

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const PLANS = [
  {
    code: 'FREE',
    name: 'Free',
    description: 'Free tier: 1 hostel, up to 30 residents, 2 members.',
    status: 'PUBLISHED',
    priceAmount: null,
    billingCycle: 'MONTHLY',
    maxHostels: 1,
    maxRooms: null,
    maxBeds: null,
    maxResidents: 30,
    maxMembers: 2,
    maxDevices: 2,
    advancedReports: false,
    csvExport: false,
    detailedFinance: false,
  },
  {
    code: 'PRO',
    name: 'Pro',
    description: 'Pro tier: 3 hostels, up to 300 residents, 10 members.',
    status: 'PUBLISHED',
    priceAmount: null,
    billingCycle: 'MONTHLY',
    maxHostels: 3,
    maxRooms: null,
    maxBeds: null,
    maxResidents: 300,
    maxMembers: 10,
    maxDevices: 10,
    advancedReports: true,
    csvExport: true,
    detailedFinance: false,
  },
  {
    code: 'BUSINESS',
    name: 'Business',
    description: 'Business tier: configurable limits and advanced finance.',
    status: 'PUBLISHED',
    priceAmount: null,
    billingCycle: 'MONTHLY',
    maxHostels: null,
    maxRooms: null,
    maxBeds: null,
    maxResidents: null,
    maxMembers: null,
    maxDevices: null,
    advancedReports: true,
    csvExport: true,
    detailedFinance: true,
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: plan,
    });
  }
  console.log(`Seeded ${PLANS.length} subscription plans.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());