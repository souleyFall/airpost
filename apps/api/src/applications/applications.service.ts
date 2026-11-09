import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ApplicationStatus } from '../generated/prisma/enums';
import { GmailService } from '../gmail/gmail.service';
import { cleanSubject } from '../letters/letter.prompt';
import { PrismaService } from '../prisma/prisma.service';
import { canTransitionManually } from './transitions';

const OFFER_SUMMARY = {
  id: true,
  source: true,
  title: true,
  company: true,
  city: true,
  channel: true,
  applyUrl: true,
  score: true,
} as const;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
  ) {}

  /** Candidatures, les plus récemment modifiées d'abord, avec un résumé de l'offre (sans la description). */
  list(status?: ApplicationStatus, limit = 200) {
    return this.prisma.application.findMany({
      where: status ? { status } : {},
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        status: true,
        subject: true,
        validatedAt: true,
        appliedAt: true,
        createdAt: true,
        updatedAt: true,
        offer: { select: OFFER_SUMMARY },
        // Dernier échange affiché dans le suivi (le détail complet est dans GET /applications/:id).
        replies: {
          orderBy: { receivedAt: 'desc' },
          take: 1,
          select: { id: true, kind: true, receivedAt: true, snippet: true },
        },
      },
    });
  }

  async get(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        subject: true,
        body: true,
        gmailDraftId: true,
        validatedAt: true,
        appliedAt: true,
        createdAt: true,
        updatedAt: true,
        offer: {
          select: { ...OFFER_SUMMARY, description: true, contactEmail: true, postcode: true },
        },
        replies: {
          orderBy: { receivedAt: 'desc' },
          select: { id: true, kind: true, receivedAt: true, snippet: true },
        },
      },
    });
    if (!application) {
      throw new NotFoundException('Candidature introuvable');
    }
    return application;
  }

  /** Modifie l'objet et/ou le texte, seulement tant que la candidature est « à valider ». */
  async editDraft(id: string, changes: { subject?: string; body?: string }) {
    const data = {
      ...(changes.subject === undefined ? {} : { subject: cleanSubject(changes.subject) }),
      ...(changes.body === undefined ? {} : { body: changes.body.trim() }),
    };
    if (data.subject === '') {
      throw new UnprocessableEntityException('L’objet ne peut pas être vide');
    }
    const { count } = await this.prisma.application.updateMany({
      where: { id, status: 'TO_REVIEW' },
      data,
    });
    if (count === 0) {
      await this.explainMiss(id, 'Seule une candidature « à valider » peut être modifiée');
    }
    return this.get(id);
  }

  /**
   * Change le statut selon le cycle de vie. La mise à jour est conditionnée au statut lu : deux requêtes
   * concurrentes ne peuvent pas toutes les deux réussir (la seconde reçoit 409).
   */
  async changeStatus(id: string, to: ApplicationStatus) {
    const current = await this.prisma.application.findUnique({
      where: { id },
      select: { status: true, subject: true, body: true, gmailDraftId: true },
    });
    if (!current) {
      throw new NotFoundException('Candidature introuvable');
    }
    if (!canTransitionManually(current.status, to)) {
      throw new ConflictException(`Passage impossible de « ${current.status} » à « ${to} »`);
    }
    // Rien ne se valide ni ne se poste sans objet ni texte : ce qui part doit avoir été relu.
    if (to === 'VALIDATED' && (!current.subject?.trim() || !current.body?.trim())) {
      throw new UnprocessableEntityException('Objet et lettre requis pour valider');
    }

    // Revenir en arrière ou retirer la candidature rend le brouillon Gmail sans objet : on le supprime (RGPD :
    // il contient la lettre et l'adresse du recruteur). Si Gmail est injoignable, l'identifiant est conservé et
    // le brouillon sera retiré à la prochaine occasion. Une candidature « envoyée » garde son brouillon : c'est
    // Gmail qui le fait disparaître quand le message part.
    let forgetDraft = false;
    if (
      current.status === 'DRAFT_CREATED' &&
      (to === 'VALIDATED' || to === 'WITHDRAWN') &&
      current.gmailDraftId
    ) {
      forgetDraft = await this.gmail.deleteDraftQuietly(current.gmailDraftId);
    }

    const now = new Date();
    const { count } = await this.prisma.application.updateMany({
      where: { id, status: current.status },
      data: {
        status: to,
        ...(forgetDraft ? { gmailDraftId: null } : {}),
        ...(to === 'VALIDATED' ? { validatedAt: now } : {}),
        ...(to === 'TO_REVIEW' ? { validatedAt: null } : {}),
        ...(to === 'APPLIED' ? { appliedAt: now } : {}),
      },
    });
    if (count === 0) {
      throw new ConflictException('La candidature a changé entre-temps ; recharge la page');
    }
    return this.get(id);
  }

  /**
   * Supprime la candidature (RGPD : effacement) et retire de l'offre le contact du recruteur, qui n'avait de
   * raison d'être conservé que pour cette candidature. L'offre elle-même reste (donnée publique) jusqu'à sa purge.
   */
  // Le brouillon Gmail associé est supprimé aussi (sinon il resterait dans la boîte avec la lettre et l'adresse du
  // recruteur) ; `gmailDraftDeleted` vaut false si Gmail n'a pas pu être joint : l'interface le signale.
  async remove(id: string): Promise<{ gmailDraftDeleted: boolean | null }> {
    const application = await this.prisma.application.findUnique({
      where: { id },
      select: { offerId: true, gmailDraftId: true },
    });
    if (!application) {
      throw new NotFoundException('Candidature introuvable');
    }
    const gmailDraftDeleted = application.gmailDraftId
      ? await this.gmail.deleteDraftQuietly(application.gmailDraftId)
      : null;
    await this.prisma.$transaction([
      this.prisma.application.delete({ where: { id } }),
      this.prisma.offer.update({
        where: { id: application.offerId },
        data: { contactEmail: null },
      }),
    ]);
    return { gmailDraftDeleted };
  }

  private async explainMiss(id: string, conflictMessage: string): Promise<never> {
    const exists = await this.prisma.application.count({ where: { id } });
    if (exists === 0) {
      throw new NotFoundException('Candidature introuvable');
    }
    throw new ConflictException(conflictMessage);
  }
}
