import { pushLog } from './log-buffer.js';
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = process.env['LOG_LEVEL'] || 'info';
function log(level, component, msg, data) {
    if (LEVELS[level] < LEVELS[currentLevel])
        return;
    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}] [${component}]`;
    const dataStr = data !== undefined
        ? (typeof data === 'string' ? data : JSON.stringify(data))
        : undefined;
    const full = dataStr !== undefined ? `${msg} ${dataStr}` : msg;
    if (dataStr !== undefined) {
        console.log(prefix, msg, dataStr);
    }
    else {
        console.log(prefix, msg);
    }
    pushLog(level, component, full);
}
export function createLogger(component) {
    return {
        debug: (msg, data) => log('debug', component, msg, data),
        info: (msg, data) => log('info', component, msg, data),
        warn: (msg, data) => log('warn', component, msg, data),
        error: (msg, data) => log('error', component, msg, data),
    };
}
//# sourceMappingURL=logger.js.map