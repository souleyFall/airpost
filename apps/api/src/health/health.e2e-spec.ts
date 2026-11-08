import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';

describe('Santé de l’API (e2e)', () => {
  let app: INestApplication | undefined;

  // getHttpServer() est typé `any` par Nest : on le type ici une fois pour toutes.
  const http = () => {
    if (!app) throw new Error('Application de test non initialisée');
    return request(app.getHttpServer() as Server);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  // `?.` : si beforeAll a échoué, on ne masque pas l'erreur d'origine par un second plantage.
  afterAll(async () => {
    await app?.close();
  });

  it('GET /health répond 200 avec le statut du service', async () => {
    const res = await http().get('/health').expect(200);

    expect(res.body).toMatchObject({ status: 'ok', service: 'airpost-api' });
  });

  it('GET /health/ping répond pong', async () => {
    const res = await http().get('/health/ping').expect(200);

    expect(res.text).toBe('pong');
  });

  it('une route inconnue répond 404', async () => {
    await http().get('/nimportequoi').expect(404);
  });
});
