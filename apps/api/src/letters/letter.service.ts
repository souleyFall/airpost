import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { LlmError } from '../llm/llm.types';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { type Violation, checkLetter, claimedTechNotInProfile } from './guardrails';
import {
  LETTER_SYSTEM,
  assembleLetter,
  buildLetterPrompt,
  feedbackFor,
  letterSchema,
} from './letter.prompt';

export interface LetterResult {
  applicationId: string;
  subject: string;
  /** Corps généré, sans signature : c'est ce que l'utilisateur relit et modifie. */
  body: string;
  /** Lettre complète telle qu'elle partirait : corps + formule de politesse + signature. */
  preview: string;
  /** Points à vérifier à la relecture (technologies citées absentes du profil...). */
  warnings: string[];
}

const MAX_ATTEMPTS = 2;

@Injectable()
export class LetterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly llm: LlmService,
  ) {}

  async generate(userId: string, offerId: string): Promise<LetterResult> {
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de générer une lettre');
    }
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { application: { select: { id: true, status: true } } },
    });
    if (!offer) {
      throw new NotFoundException('Offre introuvable');
    }
    // Une lettre déjà validée (ou envoyée) n'est jamais écrasée par une nouvelle génération.
    if (offer.application && offer.application.status !== 'TO_REVIEW') {
      throw new ConflictException(
        'La candidature est déjà validée : la lettre ne peut plus être régénérée',
      );
    }

    const offerText = `${offer.title}\n${offer.description ?? ''}`;
    let violations: Violation[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const letter = await this.ask(
        profile,
        offer,
        attempt === 0 ? undefined : feedbackFor(violations),
      );
      const result = checkLetter(letter, { profile, offerText });
      if (result.violations.length > 0) {
        violations = result.violations;
        continue;
      }
      const application = await this.prisma.application.upsert({
        where: { offerId },
        update: { subject: letter.subject, body: letter.body },
        create: { offerId, subject: letter.subject, body: letter.body },
      });
      return {
        applicationId: application.id,
        subject: letter.subject,
        body: letter.body,
        preview: assembleLetter(profile.identity, letter.body),
        warnings: claimedTechNotInProfile(letter.body, profile).map(
          (tech) =>
            `« ${tech} » est cité dans la lettre mais ne figure pas dans ton profil : vérifie la formulation.`,
        ),
      };
    }
    // Aucun texte généré dans l'erreur : seulement la nature des refus.
    throw new UnprocessableEntityException({
      message: 'La lettre générée ne respecte pas les garde-fous ; réessaie.',
      violations,
    });
  }

  private async ask(
    profile: Parameters<typeof buildLetterPrompt>[0],
    offer: Parameters<typeof buildLetterPrompt>[1],
    feedback?: string,
  ) {
    try {
      return await this.llm.generateObject({
        system: LETTER_SYSTEM,
        user: buildLetterPrompt(profile, offer, feedback),
        schema: letterSchema,
        temperature: 0.4,
        maxOutputTokens: 1_500,
      });
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): HttpException {
    if (error instanceof LlmError) {
      switch (error.reason) {
        case 'not_configured':
          return new ServiceUnavailableException(
            'Génération indisponible : clé Gemini non configurée',
          );
        case 'rate_limited':
          return new HttpException(
            'Quota Gemini atteint, réessaie plus tard',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        case 'unauthorized':
        case 'model_unavailable':
          return new ServiceUnavailableException(
            'Génération indisponible : clé ou modèle Gemini à vérifier',
          );
        default:
          return new BadGatewayException('Le service de génération a échoué ; réessaie');
      }
    }
    return new BadGatewayException('Le service de génération a échoué ; réessaie');
  }
}
