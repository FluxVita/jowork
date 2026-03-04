// apps/jowork — open-source edition entry point
// Phase 0 skeleton: gateway and routes to be implemented in Phase 3

import { getEdition } from '@jowork/core';

const edition = getEdition();
console.log('Jowork starting (free edition)');
console.log(`maxDataSources=${edition.maxDataSources}, agentEngines=${edition.agentEngines.join(',')}`);

// TODO Phase 3: start Express gateway, serve public/, mount routes
