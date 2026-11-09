import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  minScore: z.coerce.number().int().min(0).max(100).default(0),
});
type ListQuery = z.infer<typeof listQuery>;

// Pas de @Public() : session obligatoire (garde global). Lecture seule.
@Controller('offers')
export class OffersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Offres classées par score décroissant (les non notées à la fin), sans la description (volumineuse). */
  @Get()
  async list(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    // Sans score minimum, tout est listé, y compris les offres pas encore notées (score nul).
    const where = query.minScore > 0 ? { score: { gte: query.minScore } } : {};
    const [total, items] = await Promise.all([
      this.prisma.offer.count({ where }),
      this.prisma.offer.findMany({
        where,
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { firstSeenAt: 'desc' }],
        take: query.limit,
        skip: query.offset,
        select: {
          id: true,
          source: true,
          title: true,
          company: true,
          city: true,
          postcode: true,
          channel: true,
          applyUrl: true,
          publishedAt: true,
          firstSeenAt: true,
          score: true,
          scoreDetail: true,
        },
      }),
    ]);
    return { total, items };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    return offer;
  }
}
