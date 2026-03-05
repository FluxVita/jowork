/**
 * alerts/engine.ts — Free tier: no-op stubs
 * Premium 通过 registerAlertEngine() 注入真实实现
 */

type AlertCheckFn = () => Promise<void>;
type AlertStatusFn = () => unknown;

let _runAlertChecks: AlertCheckFn = async () => {};
let _getAlertStatus: AlertStatusFn = () => ({ alerts: [], last_check: null });

/** Premium 调用此函数注入真实实现 */
export function registerAlertEngine(fns: {
  runAlertChecks: AlertCheckFn;
  getAlertStatus: AlertStatusFn;
}) {
  _runAlertChecks = fns.runAlertChecks;
  _getAlertStatus = fns.getAlertStatus;
}

export const runAlertChecks: AlertCheckFn = () => _runAlertChecks();
export const getAlertStatus: AlertStatusFn = () => _getAlertStatus();
