/**
 * 用户友好的错误消息映射
 * 将技术性错误（HTTP 状态码、网络异常、API 错误）转为普通用户能理解的提示
 */
(function () {
  'use strict';

  /**
   * 将 Error 对象或错误字符串转为用户友好的消息
   * @param {Error|string} err
   * @param {string} [fallback] - 自定义默认消息
   * @returns {string}
   */
  function friendlyError(err, fallback) {
    if (!err) return fallback || '操作失败，请稍后重试';
    const msg = (err?.message || String(err)).trim();

    // 超时
    if (err?.name === 'AbortError' || /timeout|aborted/i.test(msg))
      return '请求超时，请检查网络连接';

    // 网络不可达
    if (/Failed to fetch|NetworkError|ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_NETWORK/i.test(msg))
      return '无法连接服务器，请检查网络';

    // 提取 Anthropic / 上游 API 返回的 JSON 错误体
    // 格式: "... API returned 400: {"type":"error","error":{"message":"..."}}"
    const apiBodyMatch = msg.match(/API returned \d+:\s*(\{[\s\S]*)/);
    if (apiBodyMatch) {
      try {
        const body = JSON.parse(apiBodyMatch[1]);
        const apiMsg = body?.error?.message || body?.message || '';
        if (apiMsg) return friendlyApiError(apiMsg);
      } catch { /* JSON 解析失败，继续往下 */ }
    }

    // HTTP 状态码
    const httpMatch = msg.match(/^HTTP\s*(\d{3})/i);
    if (httpMatch) return friendlyHttpStatus(parseInt(httpMatch[1]));

    // 含 status code 的错误（如 "401 Unauthorized"）
    const statusMatch = msg.match(/^(\d{3})\s/);
    if (statusMatch) return friendlyHttpStatus(parseInt(statusMatch[1]));

    // 已经是中文开头的消息，保留
    if (/^[\u4e00-\u9fff]/.test(msg)) return msg;

    // 常见 gateway / 模型路由错误（中文映射，不经过 JSON 路径）
    if (/no provider available/i.test(msg)) return '暂无可用的 AI 服务，请联系管理员检查配置';
    if (/all providers failed/i.test(msg)) return '所有 AI 服务暂时不可用，请稍后重试';
    if (/rate limit exceeded/i.test(msg)) return '请求过于频繁，请稍后重试';
    if (/daily budget/i.test(msg)) return '今日 AI 用量已达上限，请明天再试';
    if (/prompt too large|context window/i.test(msg)) return '消息过长，超出模型上下文限制，请缩短对话或开启新会话';
    if (/token budget/i.test(msg)) return 'Token 预算已耗尽，请开启新会话';
    if (/engine.*init|init.*fail/i.test(msg)) return 'AI 引擎初始化失败，请刷新页面重试';

    // 其他英文错误：去掉 "Error: " 前缀后直接显示（不超过 200 字符）
    // 比什么都不说要好，让用户知道实际原因
    const clean = msg.replace(/^Error:\s*/i, '').trim();
    if (clean && clean !== 'undefined' && clean !== 'null') {
      return clean.length <= 200 ? clean : clean.slice(0, 200) + '…';
    }

    // 通用 fallback
    return fallback || '操作失败，请稍后重试';
  }

  /**
   * 将 Anthropic / 上游 API 返回的错误消息映射为中文
   * @param {string} apiMsg
   * @returns {string}
   */
  function friendlyApiError(apiMsg) {
    const m = apiMsg.toLowerCase();
    if (m.includes('content filtering') || m.includes('output blocked'))
      return '回复被 AI 安全策略拦截（内容过滤）';
    if (m.includes('rate limit') || m.includes('too many requests'))
      return '请求过于频繁，请稍后重试';
    if (m.includes('context window') || m.includes('prompt too large') || m.includes('too long'))
      return '消息过长，超出模型上下文限制，请缩短对话或开启新会话';
    if (m.includes('invalid api key') || m.includes('authentication_error'))
      return '服务 API Key 无效，请联系管理员';
    if (m.includes('overloaded') || m.includes('service unavailable'))
      return 'AI 服务当前过载，请稍后重试';
    if (m.includes('daily budget') || m.includes('budget exhausted'))
      return '今日 AI 用量已达上限，请明天再试';
    // 未匹配到已知类型：直接显示原文（不超过 120 字符）
    return apiMsg.length <= 120 ? apiMsg : apiMsg.slice(0, 120) + '…';
  }

  /**
   * 将 HTTP 状态码转为用户友好消息
   * @param {number} status
   * @returns {string}
   */
  function friendlyHttpStatus(status) {
    if (status === 401) return '登录已过期，请重新登录';
    if (status === 403) return '没有权限执行此操作';
    if (status === 404) return '请求的资源不存在';
    if (status === 409) return '操作冲突，请刷新后重试';
    if (status === 429) return '操作过于频繁，请稍后重试';
    if (status >= 400 && status < 500) return '请求失败，请稍后重试';
    if (status >= 500) return '服务器暂时出错，请稍后重试';
    return '请求失败（' + status + '）';
  }

  /**
   * 将 WebSocket close code 转为用户友好消息
   * @param {number} code
   * @returns {string}
   */
  function friendlyWsClose(code) {
    if (code === 1000) return '连接已正常关闭';
    if (code === 1001) return '服务器正在重启';
    if (code === 1006) return '连接异常断开';
    if (code === 1009) return '消息过大，连接已关闭';
    if (code === 1011) return '服务器遇到错误';
    if (code === 1012) return '服务正在重启';
    if (code === 1013) return '服务繁忙，请稍后重试';
    return '连接已断开';
  }

  // 暴露为全局函数
  window.friendlyError = friendlyError;
  window.friendlyHttpStatus = friendlyHttpStatus;
  window.friendlyWsClose = friendlyWsClose;
})();
