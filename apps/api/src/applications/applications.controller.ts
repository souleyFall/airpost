import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApplicationStatus } from '../generated/prisma/enums';
import { ApplicationsService } from './applications.service';

const statusEnum = z.enum(
  Object.values(ApplicationStatus) as [ApplicationStatus, ...ApplicationStatus[]],
);

const listQuery = z.object({
  status: statusEnum.optional(),
  // Borné : la liste ne grossit pas sans limite avec les mois d'utilisation.
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
type ListQuery = z.infer<typeof listQuery>;

// Champs inconnus refusés ; au moins un champ ; tailles bornées (le texte part ensuite dans un e-mail).
const editBody = z
  .strictObject({
    subject: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(3_000).optional(),
  })
  .refine((value) => value.subject !== undefined || value.body !== undefined, {
    message: 'Au moins un champ à modifier (subject ou body)',
  });
type EditBody = z.infer<typeof editBody>;

const statusBody = z.strictObject({ status: statusEnum });
type StatusBody = z.infer<typeof statusBody>;

// Session obligatoire (garde global) ; les écritures exigent aussi le jeton CSRF.
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(listQuery)) query: ListQuery) {
    return this.applications.list(query.status, query.limit);
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.applications.get(id);
  }

  @Patch(':id')
  edit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(editBody)) body: EditBody,
  ) {
    return this.applications.editDraft(id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodValidationPipe(statusBody)) body: StatusBody,
  ) {
    return this.applications.changeStatus(id, body.status);
  }

  /** Supprime la candidature et son brouillon Gmail ; `gmailDraftDeleted: false` = brouillon à retirer à la main. */
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.applications.remove(id);
  }
}
