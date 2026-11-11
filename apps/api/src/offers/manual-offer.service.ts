import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { translateLlmError } from '../llm/llm-http';
import { MatchService } from '../matching/match.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { dedupKey } from '../sources/dedup';
import { roundedDistance } from '../sources/geo';
import { GeocoderService } from '../sources/geocoder.service';
import { MAX_COMPANY, MAX_DESCRIPTION, MAX_TITLE, cleanText } from '../sources/normalize';
import { detectContractType } from '../sources/relevance';
import {
  EXTRACTION_SYSTEM,
  buildExtractionPrompt,
  cleanApplyUrl,
  extractionSchema,
  findContactEmail,
  manualExternalId,
} from './manual-offer';

export interface ExtractedOffer {
  title: string;
  company: string | null;
  city: string | null;
  contactEmail: string | null;
}

export interface ManualOfferInput {
  text: string;
  title: string;
  company: string;
  city?: string | null;
  contactEmail?: string | null;
  applyUrl?: string | null;
}

export interface ManualOfferResult {
  id: string;
  /** Faux : l'annonce était déjà en base (même entreprise, même intitulé, même ville) ; c'est elle qui est renvoyée. */
  created: boolean;
  /** Analyse faite tout de suite (sinon : quota du modèle, elle se fera à l'ouverture de l'offre). */
  analyzed: boolean;
}

/**
 * Offres ajoutées à la main : l'utilisateur colle le texte d'une annonce vue ailleurs (et, s'il veut, son lien).
 * Rien n'est jamais téléchargé : le lien est seulement gardé pour rouvrir l'annonce, le texte vient de l'utilisateur.
 */
@Injectable()
export class ManualOfferService {
  private readonly logger = new Logger(ManualOfferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly llm: LlmService,
    private readonly geocoder: GeocoderService,
    private readonly matching: MatchService,
  ) {}

  /** Lit le texte collé et propose intitulé, entreprise, ville et adresse de contact, à vérifier par l'utilisateur. */
  async extract(text: string): Promise<ExtractedOffer> {
    let fields;
    try {
      fields = await this.llm.generateObject({
        system: EXTRACTION_SYSTEM,
        user: buildExtractionPrompt(text),
        schema: extractionSchema,
        temperature: 0,
        // Large : les modèles de secours « réfléchissent » avant de répondre et cette réflexion compte dans la limite
        // (à 300, gemini-3.6-flash était coupé en plein JSON).
        maxOutputTokens: 2_000,
      });
    } catch (error) {
      throw translateLlmError(error);
    }
    return {
      title: cleanText(fields.title, MAX_TITLE) ?? fields.title,
      company: fields.company ? (cleanText(fields.company, MAX_COMPANY) ?? null) : null,
      city: fields.city ? (cleanText(fields.city, 80) ?? null) : null,
      contactEmail: findContactEmail(text),
    };
  }

  async create(userId: string, input: ManualOfferInput): Promise<ManualOfferResult> {
    const profile = await this.profiles.get(userId);
    if (!profile) {
      throw new BadRequestException('Renseigne ton profil avant d’ajouter une offre');
    }
    const title = cleanText(input.title, MAX_TITLE);
    const company = cleanText(input.company, MAX_COMPANY);
    if (!title || !company) {
      throw new BadRequestException('Intitulé et entreprise requis');
    }
    const city = input.city ? (cleanText(input.city, 80) ?? null) : null;
    const description = cleanText(input.text, MAX_DESCRIPTION) ?? null;
    const contactEmail = input.contactEmail ? findContactEmail(input.contactEmail) : null;
    const applyUrl = cleanApplyUrl(input.applyUrl);
    const key = dedupKey(company, title, city ?? undefined);

    // Déjà en base, quelle qu'en soit la source : on ne crée pas de doublon, on renvoie l'offre existante.
    const existing = await this.prisma.offer.findFirst({
      where: { dedupKey: key },
      orderBy: { firstSeenAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      return { id: existing.id, created: false, analyzed: false };
    }

    const home = await this.geocoder.geocodePostcode(profile.identity.postcode);
    const position = city ? await this.geocoder.geocodeCity(city, home ?? undefined) : null;
    const offer = await this.prisma.offer.create({
      data: {
        source: 'MANUAL',
        externalId: manualExternalId(title, company, city),
        dedupKey: key,
        title,
        company,
        city,
        latitude: position?.latitude ?? null,
        longitude: position?.longitude ?? null,
        distanceKm: home ? roundedDistance(home, position?.latitude, position?.longitude) : null,
        description,
        applyUrl,
        contactEmail,
        channel: contactEmail ? 'EMAIL' : 'SITE',
        contractType: detectContractType(title, description, 'MANUAL'),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });

    // Ajoutée à la main = l'utilisateur s'y intéresse : analysée tout de suite. Un échec (quota) ne perd pas l'offre.
    let analyzed = false;
    try {
      await this.matching.analyzeOne(profile, offer.id);
      analyzed = true;
    } catch (error) {
      this.logger.warn(
        `Offre ajoutée sans analyse immédiate (${error instanceof Error ? error.name : 'erreur'}).`,
      );
    }
    return { id: offer.id, created: true, analyzed };
  }
}
