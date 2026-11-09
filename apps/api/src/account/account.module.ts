import { Module } from '@nestjs/common';
import { GmailModule } from '../gmail/gmail.module';
import { AuthModule } from '../auth/auth.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [AuthModule, GmailModule], // PasswordService ; suppression des brouillons Gmail
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
