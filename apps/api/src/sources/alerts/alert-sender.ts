/**
 * Vérification de l'expéditeur d'une alerte d'offres. Le nom et l'adresse affichés sont falsifiables : un message
 * d'hameçonnage peut s'afficher « donotreply@jobalert.indeed.com ». On exige donc l'adresse EXACTE et, surtout, que
 * Gmail ait validé la signature DKIM du message pour un domaine de la plateforme (en-tête `Authentication-Results`,
 * posé par Gmail lui-même à la réception, que l'expéditeur ne contrôle pas).
 */
export interface SenderRule {
  /** Adresse exacte de l'expéditeur, en minuscules. */
  address: string;
  /** Domaine de la plateforme : la signature DKIM doit être de ce domaine ou d'un sous-domaine. */
  domain: string;
}

/** « Indeed <donotreply@jobalert.indeed.com> » → « donotreply@jobalert.indeed.com ». */
export function senderAddress(from: string): string | null {
  const bracket = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  const bare = /^\s*([^\s<>@]+@[^\s<>@]+)\s*$/.exec(from);
  const address = bracket?.[1] ?? bare?.[1];
  return address ? address.toLowerCase() : null;
}

/** Domaines pour lesquels Gmail a validé une signature DKIM (`dkim=pass ... header.d=domaine` ou `header.i=@domaine`). */
export function dkimPassDomains(authenticationResults: string): string[] {
  const domains: string[] = [];
  for (const match of authenticationResults.matchAll(
    /dkim=pass\b[^;]*?\bheader\.(?:d|i)=@?([a-z0-9][a-z0-9.-]*)/gi,
  )) {
    if (match[1]) domains.push(match[1].toLowerCase());
  }
  return domains;
}

export function isAuthentic(
  message: { from: string; authenticationResults: string },
  rule: SenderRule,
): boolean {
  if (senderAddress(message.from) !== rule.address.toLowerCase()) return false;
  const domain = rule.domain.toLowerCase();
  return dkimPassDomains(message.authenticationResults).some(
    (signed) => signed === domain || signed.endsWith(`.${domain}`),
  );
}
