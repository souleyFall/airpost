import { Injectable } from '@nestjs/common';
import type { HealthStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

/** Ce que l'interface a besoin de savoir d'une connexion : jamais de message d'erreur d'origine (URL, clé, contenu). */
export interface ApiHealthItem {
  key: string;
  status: HealthStatus;
  checkedAt: Date;
  lastOkAt: Date | null;
}

/** « rate_limited » → quota, « unauthorized » → clé refusée, « not_configured » → désactivée, le reste → panne. */
export function statusFromReason(reason: string | undefined): HealthStatus {
  if (reason === 'rate_limited') return 'QUOTA';
  if (reason === 'unauthorized') return 'AUTH';
  if (reason === 'not_configured') return 'OFF';
  return 'DOWN';
}

/**
 * Santé de chaque connexion externe (sources d'offres, Gemini), mise à jour par les collectes et les appels au modèle :
 * aucun appel de test en plus, donc aucune requête de quota gaspillée. Une ligne par connexion.
 */
@Injectable()
export class ApiHealthService {
  /** Dernier état écrit, par connexion : on n'écrit en base que si quelque chose change (Gemini est appelé souvent). */
  private readonly known = new Map<string, HealthStatus>();

  constructor(private readonly prisma: PrismaService) {}

  async record(key: string, status: HealthStatus): Promise<void> {
    const now = new Date();
    await this.prisma.apiHealth.upsert({
      where: { key },
      create: { key, status, checkedAt: now, lastOkAt: status === 'OK' ? now : null },
      update: { status, checkedAt: now, ...(status === 'OK' ? { lastOkAt: now } : {}) },
    });
    this.known.set(key, status);
  }

  /** Comme `record`, mais sans écriture si l'état est le même que le dernier connu (appels très fréquents). */
  async recordIfChanged(key: string, status: HealthStatus): Promise<void> {
    if (this.known.get(key) === status) return;
    await this.record(key, status);
  }

  async list(): Promise<ApiHealthItem[]> {
    return this.prisma.apiHealth.findMany({
      orderBy: { key: 'asc' },
      select: { key: true, status: true, checkedAt: true, lastOkAt: true },
    });
  }
}
