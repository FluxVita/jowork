// apps/fluxvita — FluxVita internal edition entry point
// Phase 0 skeleton: gateway and premium activation to be implemented in Phase 4

import { getEdition } from '@jowork/core';
import { activatePremium } from '@jowork/premium';

// Load premium license from env (Phase 4+)
const licenseKey = process.env['JOWORK_LICENSE_KEY'] ?? '';
if (licenseKey) {
  activatePremium(licenseKey);
}

const edition = getEdition();
console.log('FluxVita starting (premium edition)');
console.log(`agentEngines=${edition.agentEngines.join(',')}, hasGeekMode=${edition.hasGeekMode}`);

// TODO Phase 4: start Express gateway with full route set
