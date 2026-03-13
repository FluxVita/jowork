/**
 * 网络请求重试工具
 * 对 502/503/504 和网络错误自动重试（指数退避），用户无感。
 * 所有重试耗尽后才抛出错误。
 */
(function () {
  'use strict';

  const RETRY_STATUS = new Set([502, 503, 504]);
  const DEFAULTS = { maxRetries: 3, baseDelay: 1000, maxDelay: 8000 };

  /**
   * 带自动重试的 fetch 封装
   * @param {string} url
   * @param {RequestInit} [opts]
   * @param {{ maxRetries?: number, baseDelay?: number, maxDelay?: number }} [retryOpts]
   * @returns {Promise<Response>}
   */
  async function fetchRetry(url, opts, retryOpts) {
    const { maxRetries, baseDelay, maxDelay } = { ...DEFAULTS, ...retryOpts };
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(url, opts);
        // 仅对可重试的状态码进行重试，且不是最后一次尝试
        if (RETRY_STATUS.has(resp.status) && attempt < maxRetries) {
          lastError = new Error('HTTP ' + resp.status);
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await sleep(delay);
          continue;
        }
        return resp;
      } catch (err) {
        lastError = err;
        // AbortError / 用户取消 → 不重试
        if (err.name === 'AbortError') throw err;
        // 网络错误且还有重试机会
        if (attempt < maxRetries) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  window.fetchRetry = fetchRetry;
})();
