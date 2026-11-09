import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { type Profile, profileSchema } from './profile.schema';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Profil de l'utilisateur, ou null s'il n'a rien renseigné. */
  async get(userId: string): Promise<Profile | null> {
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    // Relu à travers le schéma : une ligne écrite à la main ou par une ancienne version ne passe pas
    // silencieusement dans la génération des lettres.
    return row ? profileSchema.parse(row.data) : null;
  }

  /** Remplace le profil entier (PUT : idempotent, pas de fusion partielle). */
  async save(userId: string, profile: Profile): Promise<Profile> {
    const row = await this.prisma.profile.upsert({
      where: { userId },
      update: { data: profile },
      create: { userId, data: profile },
    });
    return profileSchema.parse(row.data);
  }
}
