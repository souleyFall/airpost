import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { LlmError } from './llm.types';

/** Erreur du modèle → réponse HTTP compréhensible, sans prompt ni contenu généré. */
export function translateLlmError(error: unknown): HttpException {
  if (error instanceof LlmError) {
    switch (error.reason) {
      case 'not_configured':
        return new ServiceUnavailableException(
          'Génération indisponible : clé Gemini non configurée',
        );
      case 'rate_limited':
        return new HttpException(
          'Quota Gemini atteint, réessaie plus tard',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 'unauthorized':
      case 'model_unavailable':
        return new ServiceUnavailableException(
          'Génération indisponible : clé ou modèle Gemini à vérifier',
        );
      default:
        return new BadGatewayException('Le service de génération a échoué ; réessaie');
    }
  }
  return new BadGatewayException('Le service de génération a échoué ; réessaie');
}
