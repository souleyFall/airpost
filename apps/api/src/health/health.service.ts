import { Injectable } from '@nestjs/common';

// @Injectable() dit à Nest : « cette classe peut être fournie à d'autres classes ».
@Injectable()
export class HealthService {
  status() {
    return {
      status: 'ok',
      service: 'airpost-api',
      version: '0.0.0',
      time: new Date().toISOString(),
    };
  }
}
