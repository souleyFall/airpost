import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

// @Controller('health') : toutes les routes de cette classe commencent par /health.
@Controller('health')
export class HealthController {
  // Le controller ne crée pas le service : il le demande ici, et Nest le lui donne.
  constructor(private readonly health: HealthService) {}

  // @Get() : cette méthode répond à GET /health.
  @Get()
  check() {
    return this.health.status();
  }
}
