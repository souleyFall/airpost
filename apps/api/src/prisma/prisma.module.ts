import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global : PrismaService est disponible dans tous les modules sans réimporter PrismaModule.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
