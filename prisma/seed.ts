import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

const DEFAULT_PIN = hashSync('0000', 10);

const USERS = [
  { id: 'me', name: '담당자', role: 'ADMIN', pool: null },
  { id: 'safety', name: '안전담당', role: 'SAFETY', pool: null },
  { id: 'driver', name: '운전직', role: 'DRIVER', pool: null },
  { id: 'chief', name: '동장', role: 'CHIEF', pool: null },
  { id: 'pub1', name: '공무관1', role: 'PUBLIC_WORKER', pool: 'PUB' },
  { id: 'pub2', name: '공무관2', role: 'PUBLIC_WORKER', pool: 'PUB' },
  { id: 'pub3', name: '공무관3', role: 'PUBLIC_WORKER', pool: 'PUB' },
  { id: 'keep1', name: '지킴이1', role: 'KEEPER', pool: 'KEEP' },
  { id: 'keep2', name: '지킴이2', role: 'KEEPER', pool: 'KEEP' },
  { id: 'keep3', name: '지킴이3', role: 'KEEPER', pool: 'KEEP' },
  { id: 'keep4', name: '지킴이4', role: 'KEEPER', pool: 'KEEP' },
  { id: 'keep5', name: '지킴이5', role: 'KEEPER', pool: 'KEEP' },
  { id: 'res1', name: '자원관리사1', role: 'RESOURCE', pool: 'RES' },
  { id: 'res2', name: '자원관리사2', role: 'RESOURCE', pool: 'RES' },
];

async function main() {
  console.log('Seeding database...');

  for (const user of USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: {
        ...user,
        pinHash: DEFAULT_PIN,
      },
    });
  }

  console.log(`Seeded ${USERS.length} users (default PIN: 0000)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
