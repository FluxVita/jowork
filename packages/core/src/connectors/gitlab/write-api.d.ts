/**
 * GitLab 写入 API — 供 Agent 工具调用
 *
 * 只封装写操作，读操作继续走 GitLabConnector。
 * 所有调用都需要现有的 GITLAB_TOKEN（已有写权限）。
 */
export interface GitLabBranch {
    name: string;
    commit: {
        id: string;
    };
    web_url: string;
}
export interface GitLabMR {
    iid: number;
    title: string;
    state: string;
    web_url: string;
    source_branch: string;
    target_branch: string;
    description: string | null;
}
export interface GitLabCommit {
    id: string;
    short_id: string;
    title: string;
    web_url: string;
}
/** 创建分支（基于 ref，默认 main/master） */
export declare function createBranch(projectId: number, branchName: string, ref?: string): Promise<GitLabBranch>;
/** 检查分支是否存在 */
export declare function branchExists(projectId: number, branchName: string): Promise<boolean>;
/** 创建或更新文件（自动判断文件是否存在） */
export declare function createOrUpdateFile(opts: {
    projectId: number;
    filePath: string;
    content: string;
    branchName: string;
    commitMessage: string;
    authorName?: string;
    authorEmail?: string;
}): Promise<GitLabCommit>;
/** 创建 MR */
export declare function createMergeRequest(opts: {
    projectId: number;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description?: string;
    assigneeUsername?: string;
    labels?: string[];
    removeSourceBranch?: boolean;
}): Promise<GitLabMR>;
/** 获取项目默认分支 */
export declare function getDefaultBranch(projectId: number): Promise<string>;
//# sourceMappingURL=write-api.d.ts.map