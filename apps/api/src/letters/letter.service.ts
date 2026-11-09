import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { translateLlmError } from '../llm/llm-http';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { type Violation, checkLetter, claimedTechNotInProfile } from './guardrails';
import {
  LETTER_SYSTEM,
  assembleLetter,
  buildLetterPrompt,
  cleanSubject,
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
      const generated = await this.ask(
        profile,
        offer,
        attempt === 0 ? undefined : feedbackFor(violations),
      );
      // Objet sur une seule ligne : il deviendra un en-tête de message.
      const letter = { ...generated, subject: cleanSubject(generated.subject) };
      const result = checkLetter(letter, { profile, offerText });
      if (result.violations.length > 0) {
        violations = result.violations;
        continue;
      }
      const applicationId = await this.saveDraft(offerId, letter.subject, letter.body);
      return {
        applicationId,
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

  /**
   * Enregistre le brouillon SANS jamais écraser une candidature déjà validée, même si elle l'a été pendant la
   * génération (qui dure plusieurs secondes) : la mise à jour est conditionnée au statut « à valider », et la
   * création concurrente (double clic) est rattrapée par la contrainte d'unicité.
   */
  private async saveDraft(offerId: string, subject: string, body: string): Promise<string> {
    const updateDraft = () =>
      this.prisma.application.updateMany({
        where: { offerId, status: 'TO_REVIEW' },
        data: { subject, body },
      });
    const idOf = async () =>
      (
        await this.prisma.application.findUniqueOrThrow({
          where: { offerId },
          select: { id: true },
        })
      ).id;

    if ((await updateDraft()).count > 0) {
      return idOf();
    }
    try {
      return (await this.prisma.application.create({ data: { offerId, subject, body } })).id;
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      // La candidature existe déjà : créée à l'instant (on la met à jour) ou validée entre-temps (on refuse).
      if ((await updateDraft()).count > 0) return idOf();
      throw new ConflictException(
        'La candidature est déjà validée : la lettre ne peut plus être régénérée',
      );
    }
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
        // « Régénérer » doit produire un autre texte : pas de mémoire des réponses pour les lettres.
        useCache: false,
      });
    } catch (error) {
      throw translateLlmError(error);
    }
  }
}
