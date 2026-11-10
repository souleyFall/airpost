import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PASTE_MAX, PASTE_MIN } from './manual-offer';
import {
  type ExtractedOffer,
  ManualOfferService,
  type ManualOfferResult,
} from './manual-offer.service';

const pasted = z
  .string()
  .trim()
  .min(PASTE_MIN, 'Colle le texte complet de l’annonce')
  .max(PASTE_MAX);

const extractBody = z.strictObject({ text: pasted });
type ExtractBody = z.infer<typeof extractBody>;

const createBody = z.strictObject({
  text: pasted,
  title: z.string().trim().min(2).max(200),
  company: z.string().trim().min(1).max(200),
  city: z.string().trim().max(80).nullish(),
  contactEmail: z.string().trim().max(254).nullish(),
  applyUrl: z.string().trim().max(2_000).nullish(),
});
type CreateBody = z.infer<typeof createBody>;

// Session obligatoire et jeton CSRF (garde global, POST).
@Controller('offers/manual')
export class ManualOfferController {
  constructor(private readonly manual: ManualOfferService) {}

  /** Lit le texte collé et propose les champs. Limité : chaque appel consomme le quota du modèle. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('extract')
  @HttpCode(200)
  extract(@Body(new ZodValidationPipe(extractBody)) body: ExtractBody): Promise<ExtractedOffer> {
    return this.manual.extract(body.text);
  }

  /** Enregistre l'offre (ou renvoie celle qui existe déjà) puis l'analyse. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  create(
    @Req() req: AuthenticatedRequest,
    @Body(new ZodValidationPipe(createBody)) body: CreateBody,
  ): Promise<ManualOfferResult> {
    return this.manual.create(req.auth.userId, body);
  }
}
