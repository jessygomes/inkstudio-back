import { PrismaService } from 'src/database/prisma.service';

/** Suivis de cicatrisation pas encore répondus par le salon (route `GET /follow-up/unanswered` et résumé du dashboard). */
export function findUnansweredFollowUps(prisma: Pick<PrismaService, 'followUpSubmission'>, userId: string) {
  return prisma.followUpSubmission.findMany({
    where: { isAnswered: false, userId },
    include: {
      appointment: {
        select: {
          id: true,
          title: true,
          start: true,
          end: true,
          client: { select: { id: true, firstName: true, lastName: true } },
          tatoueur: { select: { id: true, name: true } },
        },
      },
    },
  });
}
