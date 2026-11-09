import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { canTransition } from '../applications/transitions';
import type { ApplicationStatus, ReplyKind } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { UNKNOWN_COMPANY } from '../sources/normalize';
import { classifyReply, isReplyDriven, statusFromReplies } from './classify';
import { GmailClient, GmailError } from './gmail.client';
import { isValidRecipient } from './mime';

/** Délai sans réponse après lequel une candidature envoyée passe en « sans réponse ». */
export const NO_RESPONSE_DAYS = 14;
/** Bornes : une synchronisation ne balaie jamais la boîte, seulement les candidatures suivies. */
const MAX_APPLICATIONS = 50;
const MAX_MESSAGES_PER_APPLICATION = 10;
const SNIPPET_MAX = 300;

export interface SyncReport {
  checked: number;
  newReplies: number;
  statusChanges: number;
  noResponse: number;
  /** Candidatures qu'on n'a pas pu chercher (entreprise inconnue) ou dont la recherche a échoué. */
  skipped: number;
  finishedAt: string;
}

/** Requête Gmail pour retrouver les réponses à une candidature : expéditeur connu, sinon nom de l'entreprise. */
export function buildQuery(app: {
  appliedAt: Date;
  contactEmail: string | null;
  company: string;
}): string | null {
  const after = Math.floor(app.appliedAt.getTime() / 1000);
  if (app.contactEmail && isValidRecipient(app.contactEmail)) {
    const domain = app.contactEmail.split('@')[1] ?? '';
    return `after:${after} -from:me from:@${domain}`;
  }
  // Guillemets et barres obliques retirés : le nom est cité tel quel, jamais interprété comme un opérateur.
  const company = app.company.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!company || company === UNKNOWN_COMPANY) {
    return null;
  }
  return `after:${after} -from:me "${company}"`;
}

@Injectable()
export class ReplySyncService {
  private readonly logger = new Logger(ReplySyncService.name);
  private running = false;
  private last: SyncReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: GmailClient,
  ) {}

  lastReport(): SyncReport | null {
    return this.last;
  }

  /**
   * Cherche dans Gmail les réponses aux candidatures envoyées, les classe par règles et met les statuts à jour.
   * Une seule synchronisation à la fois. Seuls l'extrait (300 caractères) et la catégorie sont conservés.
   */
  async sync(): Promise<SyncReport> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Gmail n’est pas configuré sur ce serveur');
    }
    if (this.running) {
      throw new HttpException('Une synchronisation est déjà en cours', HttpStatus.CONFLICT);
    }
    this.running = true;
    try {
      const report = await this.run();
      this.last = report;
      return report;
    } catch (error) {
      throw this.translate(error);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<SyncReport> {
    const applications = await this.prisma.application.findMany({
      where: {
        // Un entretien peut encore se terminer par un refus : on continue à suivre jusqu'au statut final.
        status: { in: ['APPLIED', 'ACKNOWLEDGED', 'INTERVIEW', 'NO_RESPONSE'] },
        appliedAt: { not: null },
      },
      orderBy: { appliedAt: 'asc' },
      take: MAX_APPLICATIONS,
      select: {
        id: true,
        status: true,
        appliedAt: true,
        offer: { select: { company: true, contactEmail: true } },
        replies: { select: { kind: true } },
      },
    });

    const report: SyncReport = {
      checked: 0,
      newReplies: 0,
      statusChanges: 0,
      noResponse: 0,
      skipped: 0,
      finishedAt: '',
    };
    for (const app of applications) {
      if (!app.appliedAt) continue;
      const query = buildQuery({
        appliedAt: app.appliedAt,
        contactEmail: app.offer.contactEmail,
        company: app.offer.company,
      });
      if (!query) {
        report.skipped += 1;
        continue;
      }
      report.checked += 1;
      const kinds: ReplyKind[] = app.replies.map((reply) => reply.kind);
      let added: number;
      try {
        added = await this.collect(app.id, query, kinds);
      } catch (error) {
        // Autorisation expirée ou quota : inutile de continuer, les autres échoueraient aussi.
        if (
          error instanceof GmailError &&
          ['unauthorized', 'rate_limited'].includes(error.reason)
        ) {
          throw error;
        }
        report.skipped += 1;
        continue;
      }
      report.newReplies += added;

      if (await this.advance(app.id, app.status, kinds)) {
        report.statusChanges += 1;
      }
      if (
        app.status === 'APPLIED' &&
        kinds.length === 0 &&
        Date.now() - app.appliedAt.getTime() >= NO_RESPONSE_DAYS * 86_400_000
      ) {
        const { count } = await this.prisma.application.updateMany({
          where: { id: app.id, status: 'APPLIED' },
          data: { status: 'NO_RESPONSE' },
        });
        report.noResponse += count;
      }
    }
    report.finishedAt = new Date().toISOString();
    this.logger.log(
      `Synchronisation Gmail : ${report.checked} candidature(s), ${report.newReplies} réponse(s), ${report.statusChanges} statut(s).`,
    );
    return report;
  }

  /** Enregistre les nouveaux messages d'une candidature ; renvoie leur nombre et complète `kinds`. */
  private async collect(applicationId: string, query: string, kinds: ReplyKind[]): Promise<number> {
    const ids = await this.client.searchMessageIds(query, MAX_MESSAGES_PER_APPLICATION);
    if (ids.length === 0) return 0;
    const known = new Set(
      (
        await this.prisma.reply.findMany({
          where: { gmailMessageId: { in: ids } },
          select: { gmailMessageId: true },
        })
      ).map((reply) => reply.gmailMessageId),
    );
    let added = 0;
    for (const id of ids) {
      if (known.has(id)) continue;
      const meta = await this.client.messageMeta(id);
      const kind = classifyReply({ subject: meta.subject, snippet: meta.snippet });
      try {
        await this.prisma.reply.create({
          data: {
            applicationId,
            gmailMessageId: meta.id,
            kind,
            receivedAt: meta.receivedAt,
            snippet: meta.snippet.slice(0, SNIPPET_MAX),
          },
        });
      } catch (error) {
        // Même message rattaché à deux candidatures d'une même entreprise : le premier gagne.
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }
      kinds.push(kind);
      added += 1;
    }
    return added;
  }

  /**
   * Fait avancer le statut selon les réponses, sans jamais reculer (un refus ou un entretien détecté ne repasse
   * pas en « accusé »). Les corrections de l'utilisateur passent par `recompute`.
   */
  private async advance(
    id: string,
    current: ApplicationStatus,
    kinds: ReplyKind[],
  ): Promise<boolean> {
    if (!isReplyDriven(current)) return false;
    const target = statusFromReplies(kinds);
    if (target === 'APPLIED' || target === current || !canTransition(current, target)) {
      return false;
    }
    const { count } = await this.prisma.application.updateMany({
      where: { id, status: current },
      data: { status: target },
    });
    return count > 0;
  }

  /**
   * Corrige la catégorie d'un message et recalcule le statut de la candidature à partir de ses réponses
   * (c'est la seule façon de revenir d'un classement erroné, y compris d'un « refus » détecté à tort).
   */
  async correct(replyId: string, kind: ReplyKind) {
    const reply = await this.prisma.reply.findUnique({
      where: { id: replyId },
      select: { applicationId: true, application: { select: { status: true } } },
    });
    if (!reply) {
      throw new NotFoundException('Message introuvable');
    }
    await this.prisma.reply.update({ where: { id: replyId }, data: { kind } });
    if (isReplyDriven(reply.application.status)) {
      const kinds = (
        await this.prisma.reply.findMany({
          where: { applicationId: reply.applicationId },
          select: { kind: true },
        })
      ).map((r) => r.kind);
      await this.prisma.application.updateMany({
        where: { id: reply.applicationId, status: reply.application.status },
        data: { status: statusFromReplies(kinds) },
      });
    }
    return this.prisma.reply.findUniqueOrThrow({
      where: { id: replyId },
      select: { id: true, kind: true, receivedAt: true, snippet: true, applicationId: true },
    });
  }

  private translate(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof GmailError) {
      if (error.reason === 'unauthorized') {
        return new ServiceUnavailableException(
          'Autorisation Gmail expirée ou refusée : reconnecte Gmail puis réessaie',
        );
      }
      if (error.reason === 'rate_limited') {
        return new HttpException(
          'Quota Gmail atteint, réessaie plus tard',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return new BadGatewayException('Gmail a échoué ; réessaie');
  }
}
