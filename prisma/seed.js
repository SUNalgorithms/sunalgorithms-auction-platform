const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const existingSeller = await prisma.user.findUnique({ where: { email: 'seller@test.com' } });
  if (existingSeller) {
    console.log('✅ Super users already exist');
    return;
  }

  const sellerPassword = await bcrypt.hash('Test123!', 10);
  const buyerPassword = await bcrypt.hash('Test123!', 10);

  await prisma.user.create({
    data: {
      name: 'Test Seller',
      email: 'seller@test.com',
      password: sellerPassword,
      idNumber: '8001011234567',
      phone: '0821234567',
      deviceId: 'super_seller_device',
      ip: '127.0.0.1',
      role: 'seller',
      kycLevel: 5,
      kycData: { verifiedAt: Date.now(), smileJobId: 'super_seller' },
      sellerRequirements: {
        depositAmount: 5000,
        minKycLevel: 1,
        requiredDocs: ['ID', 'Proof of Address'],
        servicesOffered: ['inspection', 'transport'],
        ppraReg: 'PPRA12345',
        bbbeeLevel: 1,
        saiaMember: true
      },
      sellerProfile: {
        trustScore: 4.9,
        totalRatings: 0,
        ratingBreakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        badges: ['Fast Payment', 'Professional']
      }
    }
  });

  await prisma.user.create({
    data: {
      name: 'Test Buyer',
      email: 'buyer@test.com',
      password: buyerPassword,
      idNumber: '9001011234567',
      phone: '0827654321',
      deviceId: 'super_buyer_device',
      ip: '127.0.0.1',
      role: 'buyer',
      kycLevel: 5,
      kycData: { verifiedAt: Date.now(), smileJobId: 'super_buyer' }
    }
  });

  console.log('✅ Super users seeded');
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());