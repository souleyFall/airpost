import { Body, Controller, Get, NotFoundException, Put, Req, UsePipes } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Profile, profileSchema } from './profile.schema';
import { ProfileService } from './profile.service';

// Pas de @Public() : le garde global exige une session, et l'écriture exige aussi le jeton CSRF.
@Controller('profile')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest): Promise<Profile> {
    // L'identifiant vient de la session, jamais de la requête : on ne peut lire que son propre profil.
    const profile = await this.profiles.get(req.auth.userId);
    if (!profile) {
      throw new NotFoundException('Profil non renseigné');
    }
    return profile;
  }

  @Put()
  @UsePipes(new ZodValidationPipe(profileSchema))
  save(@Req() req: AuthenticatedRequest, @Body() body: Profile): Promise<Profile> {
    return this.profiles.save(req.auth.userId, body);
  }
}
