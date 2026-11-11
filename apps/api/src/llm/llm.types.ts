export interface LlmRequest {
  /** Consignes du développeur : ce que le modèle doit faire et ne jamais faire. */
  system: string;
  /** Contenu à traiter (peut contenir du texte venu d'un tiers : voir `untrusted`). */
  user: string;
  temperature: number;
  maxOutputTokens: number;
}

export interface LlmUsage {
  promptTokens: number;
  outputTokens: number;
}

export interface LlmResponse {
  /** Texte brut renvoyé par le modèle (du JSON, la sortie étant demandée en JSON). */
  text: string;
  usage: LlmUsage;
  /** Modèle qui a répondu (peut être un modèle de secours) : pour les journaux, jamais pour le contenu. */
  model?: string;
}

/**
 * Fournisseur de modèle de langage, interchangeable (Gemini aujourd'hui, un autre demain) : le reste de
 * l'application ne dépend que de ce contrat.
 */
export abstract class LlmProvider {
  abstract generate(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorReason =
  | 'not_configured'
  | 'unauthorized'
  | 'rate_limited'
  | 'model_unavailable'
  | 'unavailable'
  | 'blocked'
  | 'truncated'
  | 'invalid_output';

/** Erreur du modèle, sans secret, sans prompt et sans contenu généré dans le message. */
export class LlmError extends Error {
  constructor(
    readonly reason: LlmErrorReason,
    message: string,
    /** Code HTTP de la réponse du service, quand il y en a eu une (5xx : surcharge passagère, souvent). */
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
