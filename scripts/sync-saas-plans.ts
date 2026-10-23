/* Liste (et corrige avec --apply) les users dont User.saasPlan diffère de saasPlanDetails.currentPlan. */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  const users = await prisma.user.findMany({
    where: { saasPlanDetails: { isNot: null } },
    select: {
      id: true,
      email: true,
      salonName: true,
      saasPlan: true,
      saasPlanUntil: true,
      saasPlanDetails: { select: { currentPlan: true, planStatus: true, endDate: true } },
    },
  });

  const mismatched = users.filter((u) => u.saasPlanDetails && u.saasPlanDetails.currentPlan !== u.saasPlan);
  console.log(apply ? '== APPLY ==' : '== DRY RUN ==');
  console.log(`${mismatched.length} utilisateur(s) désynchronisé(s) sur ${users.length}`);
  for (const u of mismatched) {
    const d = u.saasPlanDetails!;
    console.log(
      `  ${u.salonName ?? u.email} (${u.id}) user.saasPlan=${u.saasPlan} until=${u.saasPlanUntil?.toISOString() ?? null} | details=${d.currentPlan}/${d.planStatus} end=${d.endDate?.toISOString() ?? null}`,
    );
  }

  if (!apply) return;
  for (const u of mismatched) {
    const d = u.saasPlanDetails!;
    await prisma.user.update({
      where: { id: u.id },
      data: { saasPlan: d.currentPlan, saasPlanUntil: d.currentPlan === 'FREE' ? null : (d.endDate ?? u.saasPlanUntil) },
    });
  }
  console.log(`${mismatched.length} utilisateur(s) corrigé(s).`);
}

main().finally(() => prisma.$disconnect());
