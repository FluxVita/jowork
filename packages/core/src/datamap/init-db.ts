import { initSchema } from './db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('init-db');
log.info('Initializing database...');
initSchema();
log.info('Done.');
