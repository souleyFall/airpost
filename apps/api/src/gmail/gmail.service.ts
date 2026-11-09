import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { assembleLetter } from '../letters/letter.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { GmailClient, GmailError } from './gmail.client';
import { buildRawMessage, isValidRecipient } from './mime';

export interface DraftResult {
  applicationId: string;
  draftId: string;
  /** Destinataire pré-rempli, ou null (candidature par le site, ou aucune adresse connue). */
  to: string | null;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly client: GmailClient,
  ) {}

  status() {
    return { configured: this.client.isConfigured() };
  }

  /**
   * Crée le brouillon Gmail d'une candidature VALIDÉE (jamais d'envoi : l'étendue gmail.send n'est pas demandée).
   * Le statut « brouillon créé » n'est posé qu'ici : l'utilisateur ne peut pas prétendre qu'un brouillon existe.
   */
  async createDraft(userId: string, applicationId: string): Promise<DraftResult> {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        status: true,
        subject: true,
        body: true,
        gmailDraftId: true,
        offer: { select: { contactEmail: true, channel: true } },
      },
    });
    if (!application) {
      throw new NotFoundException('Candidature introuvable');
    }
    if (application.status !== 'VALIDATED') {
      throw new ConflictException('Seule une candidature validée peut recevoir un brouillon Gmail');
    }
    if (!application.subject?.trim() || !application.body?.trim()) {
      throw new UnprocessableEntityException('Objet et lettre requis');
    }
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant de créer un brouillon');
    }

    // Une adresse mal formée n'est jamais envoyée à Gmail : le brouillon est créé sans destinataire.
    const contact = application.offer.contactEmail;
    const to =
      application.offer.channel === 'EMAIL' && contact && isValidRecipient(contact)
        ? contact
        : null;
    const raw = buildRawMessage({
      ...(to ? { to } : {}),
      subject: application.subject,
      body: assembleLetter(profile.identity, application.body),
    });

    // Un ancien brouillon resté après un retour en arrière est retiré avant d'en créer un nouveau.
    if (application.gmailDraftId) {
      await this.deleteDraftQuietly(application.gmailDraftId);
    }

    const draftId = await this.guard(() => this.client.createDraft(raw));
    // La mise à jour est conditionnée au statut lu : si la candidature a changé pendant l'appel à Gmail,
    // on retire le brouillon qu'on vient de créer plutôt que de laisser une copie orpheline dans la boîte.
    const { count } = await this.prisma.application.updateMany({
      where: { id: applicationId, status: 'VALIDATED' },
      data: { status: 'DRAFT_CREATED', gmailDraftId: draftId },
    });
    if (count === 0) {
      await this.deleteDraftQuietly(draftId);
      throw new ConflictException('La candidature a changé entre-temps ; recharge la page');
    }
    return { applicationId, draftId, to };
  }

  /**
   * Supprime un brouillon sans jamais faire échouer l'opération appelante (suppression d'une candidature,
   * effacement du compte) : renvoie false si Gmail n'a pas pu être joint, pour que l'interface le signale.
   */
  async deleteDraftQuietly(draftId: string): Promise<boolean> {
    try {
      await this.client.deleteDraft(draftId);
      return true;
    } catch (error) {
      // Seulement la nature du problème, jamais le contenu.
      this.logger.warn(
        `Brouillon Gmail non supprimé (${error instanceof GmailError ? error.reason : 'erreur'}).`,
      );
      return false;
    }
  }

  private async guard<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      throw this.translate(error);
    }
  }

  private translate(error: unknown): HttpException {
    if (error instanceof GmailError) {
      switch (error.reason) {
        case 'not_configured':
          return new ServiceUnavailableException('Gmail n’est pas configuré sur ce serveur');
        case 'unauthorized':
          return new ServiceUnavailableException(
            'Autorisation Gmail expirée ou refusée : reconnecte Gmail puis réessaie',
          );
        case 'rate_limited':
          return new HttpException(
            'Quota Gmail atteint, réessaie plus tard',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        default:
          return new BadGatewayException('Gmail a échoué ; réessaie');
      }
    }
    return new BadGatewayException('Gmail a échoué ; réessaie');
  }
}
