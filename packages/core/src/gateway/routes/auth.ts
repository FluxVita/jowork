import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { findOrCreateByFeishu, getUserByFeishuId, listActiveUsers, updateUserRole, getUserByEmail, createEmailUser, hashPassword, verifyPassword } from '../../auth/users.js';
import { feishuApi } from '../../connectors/feishu/auth.js';
import { signToken } from '../../auth/jwt.js';
import { authMiddleware, requireRole } from '../middleware.js';
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { createLogger } from '../../utils/logger.js';
import { syncUserGroups } from '../../services/feishu-groups.js';
import { getGatewayPublicUrl } from '../../utils/gateway-url.js';
import { createAuthChallenge, verifyAuthChallenge } from '../../auth/challenges.js';
import { setUserSetting, getUserSetting } from '../../auth/settings.js';
import type { Role } from '../../types.js';

const log = createLogger('auth-route');
const router = Router();

const IS_DEV = process.env['NODE_ENV'] !== 'production';
const DEV_DIRECT_LOGIN_ENABLED = IS_DEV && process.env['DEV_DIRECT_LOGIN_ENABLED'] === 'true';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const oauthStates = new Map<string, number>();

// IP 速率限制：30s 内最多 5 次
const IP_WINDOW_MS = 30 * 1000;
const IP_MAX_ATTEMPTS = 5;
const ipAttempts = new Map<string, { count: number; resetAt: number }>();

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipAttempts.set(ip, { count: 1, resetAt: now + IP_WINDOW_MS });
    return true; // OK
  }
  entry.count++;
  return entry.count <= IP_MAX_ATTEMPTS;
}

function issueOAuthState(): string {
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
  return state;
}

function consumeOAuthState(state: string): boolean {
  const expiresAt = oauthStates.get(state);
  if (!expiresAt) return false;
  oauthStates.delete(state);
  return Date.now() <= expiresAt;
}

/**
 * POST /api/auth/login
 * 开发模式登录（仅 DEV_DIRECT_LOGIN_ENABLED=true）
 *
 * 步骤 1：不带 challenge_id → 创建挑战码，返回 challenge_id（实际 dev 中 code 也返回方便测试）
 * 步骤 2：带 challenge_id + code → 校验通过后签发 JWT
 *
 * IP 速率限制：同一 IP 30s 内最多 5 次请求
 */
router.post('/login', (req, res) => {
  if (!DEV_DIRECT_LOGIN_ENABLED) {
    res.status(403).json({
      error: 'Direct login disabled. Use /api/auth/oauth/callback with Feishu OAuth code.',
      hint: 'Set DEV_DIRECT_LOGIN_ENABLED=true only for local development.',
    });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRateLimit(ip)) {
    log.warn('Login rate limit exceeded', { ip });
    res.status(429).json({ error: 'Too many login attempts. Please wait 30 seconds.' });
    return;
  }

  const { feishu_open_id, name, email, department, challenge_id, code } = req.body as {
    feishu_open_id: string;
    name?: string;
    email?: string;
    department?: string;
    challenge_id?: string;
    code?: string;
  };

  if (!feishu_open_id) {
    res.status(400).json({ error: 'feishu_open_id is required' });
    return;
  }

  // 步骤 2：校验挑战码
  if (challenge_id && code) {
    const result = verifyAuthChallenge(challenge_id, code);
    if (!result.ok) {
      const statusMap = {
        too_many_attempts: 429,
        expired: 401,
        consumed: 409,
        not_found: 404,
        invalid_code: 401,
      } as const;
      res.status(statusMap[result.reason] ?? 401).json({
        error: result.reason,
        attempts_left: 'attempts_left' in result ? result.attempts_left : undefined,
      });
      return;
    }

    const payload = result.payload as { feishu_open_id: string; name: string; email?: string; department?: string };
    const user = findOrCreateByFeishu(payload.feishu_open_id, payload.name, { email: payload.email, department: payload.department });
    const token = signToken(user, '24h', { feishu_verified: true }); // dev login 也视为已验证，方便本地测试
    log.info('User logged in (dev challenge)', { user_id: user.user_id, name: user.name, role: user.role });
    syncUserGroups(user.user_id, payload.feishu_open_id).catch(err => log.warn('Group sync failed on login', err));
    res.json({ token, user });
    return;
  }

  // 步骤 1：创建挑战码
  if (!name) {
    res.status(400).json({ error: 'name is required for initial login' });
    return;
  }
  const challenge = createAuthChallenge('dev_login', feishu_open_id, { feishu_open_id, name, email, department });
  log.info('Login challenge issued', { feishu_open_id, challenge_id: challenge.challenge_id });
  // dev 模式：code 随响应返回（方便测试），生产环境应通过其他渠道下发
  res.json({ challenge_id: challenge.challenge_id, dev_code: challenge.code, hint: 'Submit challenge_id + code to complete login' });
});

/**
 * POST /api/auth/local — Jowork 本地模式登录（无需 Feishu OAuth）
 *
 * 适用场景：Personal 模式（本地单用户）或测试环境。
 * 由 JOWORK_LOCAL_AUTH=true 或 NODE_ENV !== 'production' 控制开关。
 *
 * 请求体：{ username: string, display_name?: string }
 * 响应：{ token, user }
 */
const JOWORK_LOCAL_AUTH = process.env['JOWORK_LOCAL_AUTH'] === 'true' || process.env['NODE_ENV'] !== 'production';
router.post('/local', (req, res) => {
  if (!JOWORK_LOCAL_AUTH) {
    res.status(403).json({ error: 'Local auth disabled. Set JOWORK_LOCAL_AUTH=true to enable.' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many login attempts. Please wait 30 seconds.' });
    return;
  }

  const { username, display_name } = req.body as { username?: string; display_name?: string };
  if (!username || username.trim().length < 2) {
    res.status(400).json({ error: 'username is required (min 2 chars)' });
    return;
  }

  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const name = display_name?.trim() || cleanUsername;
  // 用 local_ 前缀的伪 feishu_open_id 区分本地账号，兼容现有 User 表结构
  const user = findOrCreateByFeishu(`local_${cleanUsername}`, name, { role: 'admin' });
  const token = signToken(user, '30d', { feishu_verified: true });
  log.info('User logged in (local auth)', { user_id: user.user_id, name: user.name });
  res.json({ token, user });
});

/**
 * POST /api/auth/signup — 邮箱注册（SaaS 公开注册）
 *
 * body: { name, email, password }
 * 密码最短 8 位，邮箱唯一。注册成功直接返回 token。
 */
router.post('/signup', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many signup attempts. Please wait.' });
    return;
  }

  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };

  if (!name || name.trim().length < 2) {
    res.status(400).json({ error: 'Name must be at least 2 characters.' });
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email required.' });
    return;
  }
  if (!password || password.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters.' });
    return;
  }

  // 检查邮箱是否已注册
  const existing = getUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: 'Email already registered.' });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = createEmailUser({ name: name.trim(), email, passwordHash });
    const token = signToken(user, '30d');
    log.info('User signed up (email)', { user_id: user.user_id, email: user.email });
    res.json({ token, user });
  } catch (err) {
    log.error('Signup failed', err);
    res.status(500).json({ error: 'Signup failed. Please try again.' });
  }
});

/**
 * POST /api/auth/email-login — 邮箱登录
 *
 * body: { email, password }
 */
router.post('/email-login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
  if (!checkIpRateLimit(ip)) {
    res.status(429).json({ error: 'Too many login attempts. Please wait 30 seconds.' });
    return;
  }

  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required.' });
    return;
  }

  const user = getUserByEmail(email);
  if (!user || !user.password_hash) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  try {
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = signToken(user, '30d');
    log.info('User logged in (email)', { user_id: user.user_id, email: user.email });
    res.json({ token, user });
  } catch (err) {
    log.error('Email login failed', err);
    res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * GET /api/auth/oauth/url — 获取飞书 OAuth 授权 URL
 */
router.get('/oauth/url', (_req, res) => {
  const { app_id } = config.feishu;
  if (!app_id) {
    res.status(500).json({ error: 'Feishu app_id not configured' });
    return;
  }

  const baseUrl = getGatewayPublicUrl();
  const redirectUri = _req.query['redirect_uri'] as string || `${baseUrl}/api/auth/oauth/callback`;
  const state = issueOAuthState();
  const url = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${app_id}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

  res.json({ url, state });
});

/**
 * GET /api/auth/oauth/callback — 飞书 OAuth 回调（浏览器跳转）
 * 飞书授权后自动跳转到此地址，带 code 参数，自动完成登录并跳回页面
 */
router.get('/oauth/callback', async (req, res) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  if (!code || !state) {
    res.status(400).send('缺少 code 或 state 参数');
    return;
  }

  if (!consumeOAuthState(state)) {
    res.status(400).send('无效或过期的 OAuth state');
    return;
  }

  const { app_id, app_secret } = config.feishu;
  if (!app_id || !app_secret) {
    res.status(500).send('飞书应用未配置');
    return;
  }

  try {
    const tokenResp = await httpRequest<{
      code: number; msg: string; app_access_token: string;
    }>('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST', body: { app_id, app_secret },
    });
    if (tokenResp.data.code !== 0) { res.status(500).send(`飞书认证失败: ${tokenResp.data.msg}`); return; }

    const userTokenResp = await httpRequest<{
      code: number; msg: string;
      data: { access_token: string; open_id: string; name?: string; email?: string; };
    }>('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenResp.data.app_access_token}` },
      body: { grant_type: 'authorization_code', code },
    });
    if (userTokenResp.data.code !== 0) { res.status(401).send(`授权失败: ${userTokenResp.data.msg}`); return; }

    const tokenData = userTokenResp.data.data;
    const userAccessToken = tokenData.access_token;

    // 用 user_access_token 获取用户详细信息
    const userInfoResp = await httpRequest<{
      code: number; msg: string;
      data: { open_id: string; name: string; email?: string; avatar_url?: string; };
    }>('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      method: 'GET',
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    const feishuUser = userInfoResp.data.code === 0 ? userInfoResp.data.data : tokenData;
    const userName = feishuUser.name || tokenData.name || '未知用户';
    const openId = feishuUser.open_id || tokenData.open_id;

    const isNewUser = !getUserByFeishuId(openId);
    const user = findOrCreateByFeishu(openId, userName, { email: feishuUser.email });
    const token = signToken(user, '24h', { feishu_verified: true });

    log.info('User logged in via OAuth (redirect)', { user_id: user.user_id, name: user.name, isNew: isNewUser });

    // 存储用户飞书 token 供 Agent 内置飞书工具使用
    try {
      const expiresIn = (tokenData as Record<string, unknown>)['expires_in'] as number ?? 7200;
      setUserSetting(user.user_id, 'feishu_user_token', userAccessToken);
      setUserSetting(user.user_id, 'feishu_user_token_expires_at', String(Date.now() + expiresIn * 1000));
    } catch (err) {
      log.warn('Failed to store feishu user token', String(err));
    }

    // 异步同步群组
    syncUserGroups(user.user_id, openId).catch(err => log.warn('Group sync failed on OAuth login', err));

    // 返回一个 HTML 页面，把 token 写入 localStorage 然后跳转
    // 若 onboarding 未完成，跳回 onboarding 继续流程；否则进主界面
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>登录成功</title></head><body>
      <script>
        localStorage.setItem(${JSON.stringify(config.token_storage_key)}, ${JSON.stringify(token)});
        localStorage.setItem(${JSON.stringify(config.token_storage_key + '_user')}, ${JSON.stringify(JSON.stringify(user))});
        if (${isNewUser}) {
          localStorage.setItem(${JSON.stringify(config.token_storage_key.replace(/_token$/, '') + '_oauth_just_done')}, '1');
          location.href = '/onboarding.html';
        } else {
          localStorage.setItem(${JSON.stringify(config.token_storage_key.replace(/_token$/, '') + '_onboarding_done')}, '1');
          location.href = '/shell.html';
        }
      </script>
    </body></html>`);
  } catch (err) {
    log.error('OAuth redirect login failed', err);
    res.status(500).send(`登录失败: ${String(err)}`);
  }
});

/**
 * POST /api/auth/oauth/callback — 飞书 OAuth 回调（API 方式）
 * 用 code 换取 user_access_token → 获取用户真实信息 → 签发 JWT
 */
router.post('/oauth/callback', async (req, res) => {
  const { code, state } = req.body as { code: string; state: string };

  if (!code || !state) {
    res.status(400).json({ error: 'OAuth code and state are required' });
    return;
  }

  if (!consumeOAuthState(state)) {
    res.status(400).json({ error: 'Invalid or expired OAuth state' });
    return;
  }

  const { app_id, app_secret } = config.feishu;
  if (!app_id || !app_secret) {
    res.status(500).json({ error: 'Feishu credentials not configured' });
    return;
  }

  try {
    // 获取 app_access_token
    const tokenResp = await httpRequest<{
      code: number; msg: string;
      app_access_token: string;
    }>('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST',
      body: { app_id, app_secret },
    });

    if (tokenResp.data.code !== 0) {
      res.status(500).json({ error: `Feishu app token error: ${tokenResp.data.msg}` });
      return;
    }

    // 用 code 换取 user_access_token
    const userTokenResp = await httpRequest<{
      code: number; msg: string;
      data: { access_token: string; open_id: string; name?: string; email?: string; };
    }>('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenResp.data.app_access_token}` },
      body: { grant_type: 'authorization_code', code },
    });

    if (userTokenResp.data.code !== 0) {
      res.status(401).json({ error: `OAuth failed: ${userTokenResp.data.msg}` });
      return;
    }

    const tokenData = userTokenResp.data.data;

    // 用 user_access_token 获取用户详细信息
    const userInfoResp = await httpRequest<{
      code: number; msg: string;
      data: { open_id: string; name: string; email?: string; };
    }>('https://open.feishu.cn/open-apis/authen/v1/user_info', {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const feishuUser = userInfoResp.data.code === 0 ? userInfoResp.data.data : tokenData;
    const userName = feishuUser.name || tokenData.name || '未知用户';
    const openId = feishuUser.open_id || tokenData.open_id;

    const user = findOrCreateByFeishu(openId, userName, { email: feishuUser.email });
    const token = signToken(user, '24h', { feishu_verified: true });

    log.info('User logged in via OAuth', { user_id: user.user_id, name: user.name, role: user.role });

    // 存储用户飞书 token 供 Agent 内置飞书工具使用
    try {
      const expiresIn = (tokenData as Record<string, unknown>)['expires_in'] as number ?? 7200;
      setUserSetting(user.user_id, 'feishu_user_token', tokenData.access_token);
      setUserSetting(user.user_id, 'feishu_user_token_expires_at', String(Date.now() + expiresIn * 1000));
    } catch (err) {
      log.warn('Failed to store feishu user token', String(err));
    }

    // 异步同步群组
    syncUserGroups(user.user_id, openId).catch(err => log.warn('Group sync failed on OAuth API login', err));

    res.json({ token, user });
  } catch (err) {
    log.error('OAuth login failed', err);
    res.status(500).json({ error: `OAuth error: ${String(err)}` });
  }
});

/**
 * POST /api/auth/cli-login
 * CLI 登录：通过设备 ID 获取 Token（首次需要飞书授权）
 */
router.post('/cli-login', (req, res) => {
  const { device_id, feishu_open_id } = req.body as { device_id: string; feishu_open_id?: string };

  if (!device_id) {
    res.status(400).json({ error: 'device_id required' });
    return;
  }

  // 如果提供了飞书 ID，直接查找用户
  if (feishu_open_id) {
    const user = getUserByFeishuId(feishu_open_id);
    if (!user) {
      res.status(404).json({ error: 'User not found. Please login via Feishu first.' });
      return;
    }
    const token = signToken(user, '7d'); // CLI token 有效期 7 天
    log.info('CLI login', { user_id: user.user_id, device: device_id });
    res.json({ token, user });
    return;
  }

  // 否则返回授权引导
  res.status(401).json({
    error: 'First-time CLI login requires feishu_open_id',
    hint: 'Run: klaude-launcher --feishu-auth to start OAuth flow',
  });
});

/** GET /api/auth/me — 获取当前用户信息（含飞书认证状态） */
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user, feishu_verified: req.feishu_verified === true });
});

/** GET /api/auth/users — 列出所有用户（仅管理员） */
router.get('/users', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const users = listActiveUsers();
  res.json({ users });
});

/** GET /api/auth/feishu-members — 从飞书通讯录拉取全员，与本地角色合并（仅管理员） */
router.get('/feishu-members', authMiddleware, requireRole('owner', 'admin'), async (req, res) => {
  try {
    // 本地用户表 indexed by feishu_open_id
    const localUsers = listActiveUsers();
    const localMap = new Map(localUsers.map(u => [u.feishu_open_id, u]));

    // 飞书通讯录：递归拉所有部门（根部门 + 子部门），合并去重
    type FeishuMember = {
      open_id: string;
      name: string;
      email?: string;
      department_ids?: string[];
      avatar?: { avatar_72: string };
      status?: { is_active: boolean };
      employee_type?: number;
    };
    type DeptInfo = { id: string; name: string; parent_id: string };

    // 拉某部门下的所有成员（分页），并注入 _found_in_dept 作为来源部门 fallback
    async function fetchDeptMembers(deptId: string): Promise<FeishuMember[]> {
      const result: FeishuMember[] = [];
      let pageToken: string | undefined;
      do {
        const params: Record<string, string> = {
          page_size: '50',
          department_id: deptId,
          user_id_type: 'open_id',
          department_id_type: 'department_id',
        };
        if (pageToken) params['page_token'] = pageToken;
        const resp = await feishuApi<{ code: number; data: { items: FeishuMember[]; has_more: boolean; page_token?: string } }>('/contact/v3/users', { params });
        if (resp.code !== 0) break;
        for (const m of resp.data?.items || []) {
          (m as Record<string, unknown>)['_found_in_dept'] = deptId;
          result.push(m);
        }
        pageToken = resp.data?.has_more ? resp.data.page_token : undefined;
      } while (pageToken);
      return result;
    }

    // 拉所有子部门（含名称、parent_id），用于判断一级部门
    async function fetchAllDepts(): Promise<DeptInfo[]> {
      const depts: DeptInfo[] = [];
      let pageToken: string | undefined;
      do {
        const params: Record<string, string> = {
          page_size: '50',
          department_id_type: 'department_id',
          fetch_child: 'true',
        };
        if (pageToken) params['page_token'] = pageToken;
        const resp = await feishuApi<{
          code: number;
          data: {
            items: { department_id: string; name: string; parent_department_id: string }[];
            has_more: boolean;
            page_token?: string;
          };
        }>('/contact/v3/departments/0/children', { params });
        if (resp.code !== 0) break;
        for (const d of resp.data?.items || []) {
          depts.push({ id: d.department_id, name: d.name, parent_id: d.parent_department_id });
        }
        pageToken = resp.data?.has_more ? resp.data.page_token : undefined;
      } while (pageToken);
      return depts;
    }

    // 并行拉所有部门成员，按 open_id 去重
    let allMembers: FeishuMember[] = [];
    let deptMap = new Map<string, DeptInfo>(); // dept_id -> DeptInfo
    try {
      const depts = await fetchAllDepts();
      for (const d of depts) deptMap.set(d.id, d);
      // 根部门 '0' 单独加入，名称暂用空字符串（后面 resolvePrimaryDept 会跳过）
      deptMap.set('0', { id: '0', name: '（根部门）', parent_id: '' });
      const deptIds = ['0', ...depts.map(d => d.id)];
      const perDept = await Promise.all(deptIds.map(id => fetchDeptMembers(id)));
      const seen = new Set<string>();
      for (const list of perDept) {
        for (const m of list) {
          if (!seen.has(m.open_id)) { seen.add(m.open_id); allMembers.push(m); }
        }
      }
    } catch (e) {
      log.error('Failed to fetch Feishu members', e);
      const localFallback = listActiveUsers();
      res.json({ members: localFallback.map(u => ({ ...u, in_system: true })), total: localFallback.length, fallback: true });
      return;
    }

    // 过滤：只保留在职正式员工（employee_type=1 为正式，status.is_activated=true）
    // employee_type: 1=正式 2=实习 3=外包 4=劳务 5=顾问；0或undefined=未设置
    const members = allMembers.filter(m => {
      if (m.status && (m.status as Record<string, unknown>)['is_activated'] === false) return false;
      if (m.employee_type !== undefined && m.employee_type !== 1) return false;
      return true;
    });

    // 根据 department_ids 取一级部门：parent_id === '0' 的为一级部门
    // 优先级：用户自身 department_ids 中的一级部门 > 任意部门 > _found_in_dept（排除根'0'）
    function resolvePrimaryDept(m: FeishuMember): { dept_id: string; dept_name: string } | null {
      const ids = (m.department_ids || []).filter(id => id !== '0');
      const foundIn = (m as Record<string, unknown>)['_found_in_dept'] as string | undefined;

      // 候选列表：用户自身 department_ids（过滤根）+ found_in_dept（过滤根）
      const candidates = [...ids];
      if (foundIn && foundIn !== '0' && !candidates.includes(foundIn)) candidates.push(foundIn);

      if (candidates.length === 0) return null;

      // 优先取 parent_id === '0' 的一级部门
      const topLevel = candidates.find(id => {
        const d = deptMap.get(id);
        return d && d.parent_id === '0';
      });
      const chosen = topLevel ?? candidates[0];
      const info = deptMap.get(chosen);
      if (!info) return null;
      return { dept_id: info.id, dept_name: info.name };
    }

    // 合并本地角色信息 + 部门信息
    const result = members.map(m => {
      const local = localMap.get(m.open_id);
      const dept = resolvePrimaryDept(m);
      return {
        feishu_open_id: m.open_id,
        name: m.name,
        email: m.email,
        avatar_url: m.avatar?.avatar_72,
        is_active: m.status?.is_active !== false,
        dept_id: dept?.dept_id ?? null,
        dept_name: dept?.dept_name ?? '未分配',
        role: local?.role ?? 'member',
        user_id: local?.user_id ?? null,
        in_system: !!local,
      };
    });

    res.json({ members: result, total: result.length });
  } catch (e) {
    log.error('Failed to fetch Feishu members', e);
    // 降级：返回本地用户
    const users = listActiveUsers();
    res.json({ members: users.map(u => ({ ...u, in_system: true })), total: users.length, fallback: true });
  }
});

/** POST /api/auth/assign-role — 分配角色 */
const VALID_ROLES: Role[] = ['owner', 'admin', 'member', 'guest'];
router.post('/assign-role', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const { user_id, role } = req.body as { user_id: string; role: Role };
  if (!user_id || !role) {
    res.status(400).json({ error: 'user_id and role are required' });
    return;
  }
  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}` });
    return;
  }

  updateUserRole(user_id, role);
  log.info('Role assigned', { target: user_id, role, by: req.user!.user_id });
  res.json({ ok: true });
});

/**
 * GET /api/auth/feishu-token-status — 查询当前用户的飞书 token 状态
 * 返回 { authorized: boolean, expires_at: number | null }
 */
router.get('/feishu-token-status', authMiddleware, (req, res) => {
  const userId = req.user!.user_id;
  const token = getUserSetting(userId, 'feishu_user_token');
  const expiresAtStr = getUserSetting(userId, 'feishu_user_token_expires_at');
  const expiresAt = expiresAtStr ? parseInt(expiresAtStr) : null;
  const authorized = !!token && (!expiresAt || expiresAt > Date.now());
  res.json({ authorized, expires_at: expiresAt });
});

// ─── Google OAuth ───────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

function isGoogleEnabled(): boolean {
  return !!(config.google?.client_id && config.google?.client_secret);
}

/**
 * GET /api/auth/google — 跳转到 Google OAuth 授权页
 */
router.get('/google', (req, res) => {
  if (!isGoogleEnabled()) {
    res.status(503).json({ error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
    return;
  }

  const state = issueOAuthState();
  const baseUrl = getGatewayPublicUrl();
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: config.google.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/**
 * GET /api/auth/google/callback — Google OAuth 回调
 */
router.get('/google/callback', async (req, res) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  const errorParam = req.query['error'] as string;

  if (errorParam) {
    res.redirect(`/signup.html?error=${encodeURIComponent('Google login cancelled')}`);
    return;
  }

  if (!code || !state) {
    res.status(400).send('Missing code or state');
    return;
  }

  if (!consumeOAuthState(state)) {
    res.status(400).send('Invalid or expired state. Please try again.');
    return;
  }

  const baseUrl = getGatewayPublicUrl();
  const redirectUri = `${baseUrl}/api/auth/google/callback`;

  try {
    // 1. 用 code 换 access_token
    const tokenResp = await httpRequest<{
      access_token: string;
      id_token?: string;
      error?: string;
    }>(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.client_id,
        client_secret: config.google.client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (tokenResp.data.error || !tokenResp.data.access_token) {
      log.error('Google token exchange failed', tokenResp.data);
      res.redirect('/signup.html?error=google_auth_failed');
      return;
    }

    // 2. 获取用户信息
    const userInfoResp = await httpRequest<{
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture?: string;
      given_name?: string;
    }>(GOOGLE_USERINFO_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenResp.data.access_token}` },
    });

    const googleUser = userInfoResp.data;
    if (!googleUser.email) {
      res.redirect('/signup.html?error=google_no_email');
      return;
    }

    // 3. 查找或创建用户（以 email 为唯一标识）
    const existingUser = getUserByEmail(googleUser.email);
    const isNew = !existingUser;

    const user = existingUser ?? createEmailUser({
      name: googleUser.name || googleUser.given_name || googleUser.email.split('@')[0],
      email: googleUser.email,
      passwordHash: '',  // 空密码 = 只能 OAuth 登录
    });

    const token = signToken(user, '30d');
    log.info('User logged in via Google OAuth', { user_id: user.user_id, email: user.email, isNew });

    // 4. 返回 HTML，写入 localStorage 并跳转
    const tokenKey = config.token_storage_key || 'jowork_token';
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Logging in...</title></head><body>
      <script>
        localStorage.setItem(${JSON.stringify(tokenKey)}, ${JSON.stringify(token)});
        localStorage.setItem(${JSON.stringify(tokenKey + '_user')}, ${JSON.stringify(JSON.stringify(user))});
        location.href = ${isNew ? '"/onboarding.html"' : '"/shell.html"'};
      </script>
      <p style="font-family:system-ui;color:#888;text-align:center;padding:40px">Signing you in...</p>
    </body></html>`);
  } catch (err) {
    log.error('Google OAuth callback error', err);
    res.redirect('/signup.html?error=google_auth_failed');
  }
});

/**
 * GET /api/auth/google/status — 检查 Google OAuth 是否已配置（供前端判断是否显示按钮）
 */
router.get('/google/status', (_req, res) => {
  res.json({ enabled: isGoogleEnabled() });
});

export default router;
