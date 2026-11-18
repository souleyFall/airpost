import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Les attentes de Testing Library (findBy…, waitFor) durent 1 s par défaut. Quand l'API et l'interface sont testées
// en même temps (pré-push, CI), la machine est chargée et des attentes légitimes dépassent cette seconde sans qu'aucun
// test soit lent seul. Le délai ne ralentit que les tests qui échouent.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());
