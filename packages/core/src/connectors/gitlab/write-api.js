/**
 * GitLab 写入 API — 供 Agent 工具调用
 *
 * 只封装写操作，读操作继续走 GitLabConnector。
 * 所有调用都需要现有的 GITLAB_TOKEN（已有写权限）。
 */
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('gitlab-write');
function baseUrl() {
    return config.gitlab.url.replace(/\/$/, '');
}
function token() {
    return config.gitlab.token;
}
async function apiPost(path, body) {
    const resp = await httpRequest(`${baseUrl()}/api/v4${path}`, {
        method: 'POST',
        headers: { 'PRIVATE-TOKEN': token(), 'Content-Type': 'application/json' },
        body,
        timeout: 15_000,
    });
    if (!resp.ok) {
        throw new Error(`GitLab API ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
    }
    return resp.data;
}
async function apiPut(path, body) {
    const resp = await httpRequest(`${baseUrl()}/api/v4${path}`, {
        method: 'PUT',
        headers: { 'PRIVATE-TOKEN': token(), 'Content-Type': 'application/json' },
        body,
        timeout: 15_000,
    });
    if (!resp.ok) {
        throw new Error(`GitLab API ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
    }
    return resp.data;
}
async function apiGet(path, params) {
    let url = `${baseUrl()}/api/v4${path}`;
    if (params)
        url += '?' + new URLSearchParams(params).toString();
    const resp = await httpRequest(url, {
        headers: { 'PRIVATE-TOKEN': token() },
        timeout: 15_000,
    });
    if (!resp.ok) {
        throw new Error(`GitLab API ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
    }
    return resp.data;
}
// ─── 分支操作 ───
/** 创建分支（基于 ref，默认 main/master） */
export async function createBranch(projectId, branchName, ref = 'main') {
    log.info(`Creating branch ${branchName} from ${ref} in project ${projectId}`);
    return apiPost(`/projects/${projectId}/repository/branches`, {
        branch: branchName,
        ref,
    });
}
/** 检查分支是否存在 */
export async function branchExists(projectId, branchName) {
    try {
        await apiGet(`/projects/${projectId}/repository/branches/${encodeURIComponent(branchName)}`);
        return true;
    }
    catch {
        return false;
    }
}
// ─── 文件操作 ───
/** 创建或更新文件（自动判断文件是否存在） */
export async function createOrUpdateFile(opts) {
    const encodedPath = encodeURIComponent(opts.filePath);
    // 检查文件是否已存在
    let exists = false;
    try {
        await apiGet(`/projects/${opts.projectId}/repository/files/${encodedPath}`, {
            ref: opts.branchName,
        });
        exists = true;
    }
    catch {
        exists = false;
    }
    const body = {
        branch: opts.branchName,
        content: opts.content,
        commit_message: opts.commitMessage,
        ...(opts.authorName ? { author_name: opts.authorName } : {}),
        ...(opts.authorEmail ? { author_email: opts.authorEmail } : {}),
    };
    if (exists) {
        log.info(`Updating file ${opts.filePath} on branch ${opts.branchName}`);
        return apiPut(`/projects/${opts.projectId}/repository/files/${encodedPath}`, body);
    }
    else {
        log.info(`Creating file ${opts.filePath} on branch ${opts.branchName}`);
        return apiPost(`/projects/${opts.projectId}/repository/files/${encodedPath}`, body);
    }
}
// ─── Merge Request ───
/** 创建 MR */
export async function createMergeRequest(opts) {
    log.info(`Creating MR: ${opts.sourceBranch} → ${opts.targetBranch} in project ${opts.projectId}`);
    // 如果需要按用户名找 assignee_id
    let assigneeId;
    if (opts.assigneeUsername) {
        try {
            const users = await apiGet('/users', {
                username: opts.assigneeUsername,
            });
            assigneeId = users[0]?.id;
        }
        catch { /* 找不到就不设 assignee */ }
    }
    return apiPost(`/projects/${opts.projectId}/merge_requests`, {
        source_branch: opts.sourceBranch,
        target_branch: opts.targetBranch,
        title: opts.title,
        description: opts.description ?? '',
        ...(assigneeId ? { assignee_id: assigneeId } : {}),
        ...(opts.labels?.length ? { labels: opts.labels.join(',') } : {}),
        remove_source_branch: opts.removeSourceBranch ?? true,
    });
}
/** 获取项目默认分支 */
export async function getDefaultBranch(projectId) {
    const project = await apiGet(`/projects/${projectId}`);
    return project.default_branch ?? 'main';
}
//# sourceMappingURL=write-api.js.map