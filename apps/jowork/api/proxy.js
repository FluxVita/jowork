/**
 * Vercel Edge Function — JoWork API Proxy
 *
 * 将 Vercel 托管的前端 /api/* 请求代理到用户自托管的 JoWork Gateway。
 *
 * 环境变量（在 Vercel Dashboard → Settings → Environment Variables 配置）：
 *   JOWORK_BACKEND_URL  必填，如 https://your-server.com:18800
 *
 * vercel.json rewrite:
 *   { "source": "/api/:path*", "destination": "/api/proxy?path=:path*" }
 */

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const backendUrl = process.env.JOWORK_BACKEND_URL;

  if (!backendUrl) {
    return new Response(
      JSON.stringify({
        error: 'Gateway not configured',
        message: 'Set JOWORK_BACKEND_URL in Vercel Dashboard → Settings → Environment Variables.',
        docs: 'https://github.com/FluxVita/jowork#deploy-to-vercel',
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 从 vercel.json rewrite 注入的 query param 中获取原始路径
  // e.g. GET /api/agent/chat → /api/proxy?path=agent/chat
  const reqUrl = new URL(req.url);
  const pathParam = reqUrl.searchParams.get('path') || '';
  const targetPath = '/api/' + pathParam.replace(/^\//, '');
  const targetUrl = backendUrl.replace(/\/$/, '') + targetPath + (reqUrl.search.replace(/[?&]?path=[^&]*/g, '').replace(/^&/, '?') || '');

  // 转发请求 headers，移除 Host
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', reqUrl.host);
  headers.set('x-forwarded-proto', 'https');

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? null : req.body,
      ...(req.body ? { duplex: 'half' } : {}),
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: 'Backend unreachable',
        message: `Cannot reach JoWork backend at ${backendUrl}.`,
        detail: String(err),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
