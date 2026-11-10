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
import { isValidRecipient } from '../gmail/mime';
import { FOLLOW_UP_STATUSES } from '../applications/follow-up';
import { type Violation, checkLetter, claimedTechNotInProfile } from './guardrails';
import {
  FOLLOW_UP_SYSTEM,
  FOLLOW_UP_WORDS,
  buildFollowUpPrompt,
  followUpSchema,
  followUpSubject,
} from './follow-up.prompt';
import {
  LETTER_SYSTEM,
  REMINDERS,
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

export interface FollowUpResult {
  applicationId: string;
  subject: string;
  /** Corps généré, sans signature : c'est ce que l'utilisateur relit et modifie. */
  body: string;
  /** Message complet tel qu'il partirait : corps + formule de politesse + signature. */
  preview: string;
  warnings: string[];
  /** Destinataire pré-rempli (candidature par e-mail), ou null. */
  to: string | null;
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
   * Rédige la relance d'une candidature envoyée et sans réponse. Rien n'est enregistré ni envoyé : l'utilisateur relit,
   * modifie, puis crée lui-même le brouillon Gmail. Une seule relance par candidature.
   */
  async generateFollowUp(userId: string, applicationId: string): Promise<FollowUpResult> {
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de rédiger une relance');
    }
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        status: true,
        subject: true,
        body: true,
        followedUpAt: true,
        offer: {
          select: {
            title: true,
            company: true,
            description: true,
            channel: true,
            contactEmail: true,
          },
        },
      },
    });
    if (!application) {
      throw new NotFoundException('Candidature introuvable');
    }
    if (!FOLLOW_UP_STATUSES.includes(application.status)) {
      throw new ConflictException(
        'Seule une candidature envoyée, sans entretien ni refus, se relance',
      );
    }
    if (application.followedUpAt) {
      throw new ConflictException('Cette candidature a déjà été relancée : une seule relance');
    }

    const sentLetter = application.body ?? '';
    // Chiffres permis : ceux de l'offre et de la lettre déjà envoyée, en plus du profil.
    const offerText = `${application.offer.title}\n${application.offer.description ?? ''}\n${sentLetter}`;
    let violations: Violation[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const feedback =
        attempt === 0
          ? undefined
          : `Ta réponse précédente a été refusée. ${violations
              .map((v) =>
                v === 'length' ? 'Respecte la longueur : entre 60 et 130 mots.' : REMINDERS[v],
              )
              .join(' ')} Réécris le message complet.`;
      const generated = await this.askFollowUp(
        profile,
        { offer: application.offer, sentLetter },
        feedback,
      );
      const subject = followUpSubject(application.subject);
      const result = checkLetter(
        { subject, body: generated.body, usedFacts: generated.usedFacts },
        { profile, offerText, words: FOLLOW_UP_WORDS },
      );
      if (result.violations.length > 0) {
        violations = result.violations;
        continue;
      }
      const contact = application.offer.contactEmail;
      return {
        applicationId,
        subject,
        body: generated.body,
        preview: assembleLetter(profile.identity, generated.body),
        warnings: claimedTechNotInProfile(generated.body, profile).map(
          (tech) =>
            `« ${tech} » est cité dans le message mais ne figure pas dans ton profil : vérifie la formulation.`,
        ),
        to:
          application.offer.channel === 'EMAIL' && contact && isValidRecipient(contact)
            ? contact
            : null,
      };
    }
    throw new UnprocessableEntityException({
      message: 'La relance générée ne respecte pas les garde-fous ; réessaie.',
      violations,
    });
  }

  private async askFollowUp(
    profile: Parameters<typeof buildFollowUpPrompt>[0],
    context: Parameters<typeof buildFollowUpPrompt>[1],
    feedback?: string,
  ) {
    try {
      return await this.llm.generateObject({
        system: FOLLOW_UP_SYSTEM,
        user: buildFollowUpPrompt(profile, context, feedback),
        schema: followUpSchema,
        temperature: 0.4,
        maxOutputTokens: 800,
        // Comme pour la lettre : « Régénérer » doit produire un autre texte.
        useCache: false,
      });
    } catch (error) {
      throw translateLlmError(error);
    }
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
