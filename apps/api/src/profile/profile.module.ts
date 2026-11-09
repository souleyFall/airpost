import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  // Exporté : le scoring et la génération des lettres liront le profil.
  exports: [ProfileService],
})
export class ProfileModule {}
