import { Injectable } from '@nestjs/common';

// @Injectable() dit à Nest : « cette classe peut être fournie à d'autres classes ».
@Injectable()
export class HealthService {
  // La route de santé est publique : elle n'expose pas la version (aide à repérer les failles connues).
  status() {
    return {
      status: 'ok',
      service: 'airpost-api',
      time: new Date().toISOString(),
    };
  }
}
