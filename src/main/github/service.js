import { getAccount, getOctokit } from './client';
const FORK_TIMEOUT_MS = 60_000;
const FORK_POLL_INTERVAL_MS = 3_000;
const HUMAN_CONFIRMATION_LABEL_COLOR = 'd93f0b';
const HUMAN_CONFIRMATION_LABEL_DESCRIPTION = 'Blocked by BuildBot until a human reviews it';
export function splitRepoFullName(fullName) {
    const [owner, repo] = fullName.split('/');
    if (!owner || !repo) {
        throw new Error(`无效仓库名: ${fullName}`);
    }
    return { owner, repo };
}
function mapRepo(repo) {
    return {
        id: repo.id,
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        updatedAt: repo.updated_at ?? new Date(0).toISOString()
    };
}
function mapIssue(issue) {
    const normalizedState = issue.state === 'closed' ? 'closed' : 'open';
    return {
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: normalizedState,
        updatedAt: issue.updated_at ?? new Date(0).toISOString(),
        labels: issue.labels
            .filter((label) => typeof label !== 'string' && typeof label === 'object' && label !== null)
            .filter((label) => Boolean(label.id && label.name && label.color && typeof label.color === 'string'))
            .map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color
        })),
        author: issue.user?.login ?? 'unknown'
    };
}
export async function listRepos(page = 1) {
    const octokit = getOctokit();
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 20,
        page,
        sort: 'updated'
    });
    return data.map(mapRepo);
}
export async function getRepo(fullName) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(fullName);
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return mapRepo(data);
}
export async function listIssues(repoFullName, filter) {
    const octokit = getOctokit();
    const account = getAccount();
    const { owner, repo } = splitRepoFullName(repoFullName);
    const { data } = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: filter.state,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
        assignee: filter.assignee === 'me' ? account.login : undefined
    });
    const normalizedKeyword = filter.keyword.trim().toLowerCase();
    return data
        .filter((issue) => !issue.pull_request)
        .map(mapIssue)
        .filter((issue) => {
        const matchLabel = filter.labels.length === 0 ||
            filter.labels.every((label) => issue.labels.some((issueLabel) => issueLabel.name === label));
        const matchKeyword = normalizedKeyword.length === 0 ||
            issue.title.toLowerCase().includes(normalizedKeyword);
        return matchLabel && matchKeyword;
    });
}
export async function getIssueDetail(repoFullName, issueNumber) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(repoFullName);
    const [{ data: issue }, { data: comments }] = await Promise.all([
        octokit.rest.issues.get({ owner, repo, issue_number: issueNumber }),
        octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: issueNumber,
            per_page: 10,
            sort: 'created',
            direction: 'asc'
        })
    ]);
    const base = mapIssue(issue);
    return {
        ...base,
        body: issue.body ?? '',
        createdAt: issue.created_at,
        comments: comments.map((comment) => ({
            id: comment.id,
            author: comment.user?.login ?? 'unknown',
            body: comment.body ?? '',
            createdAt: comment.created_at
        }))
    };
}
async function ensureLabelExists(repoFullName, name) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(repoFullName);
    try {
        await octokit.rest.issues.getLabel({ owner, repo, name });
    }
    catch (error) {
        const maybe = error;
        if (maybe.status !== 404) {
            throw error;
        }
        await octokit.rest.issues.createLabel({
            owner,
            repo,
            name,
            color: HUMAN_CONFIRMATION_LABEL_COLOR,
            description: HUMAN_CONFIRMATION_LABEL_DESCRIPTION
        });
    }
}
export async function addLabelToIssue(repoFullName, issueNumber, label) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(repoFullName);
    await ensureLabelExists(repoFullName, label);
    await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [label]
    });
}
export async function createIssueComment(repoFullName, issueNumber, body) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(repoFullName);
    await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body
    });
}
async function waitForkReady(octokit, owner, repo) {
    const deadline = Date.now() + FORK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        try {
            await octokit.rest.repos.get({ owner, repo });
            return;
        }
        catch (error) {
            await new Promise((resolve) => setTimeout(resolve, FORK_POLL_INTERVAL_MS));
        }
    }
    throw new Error('Fork 仓库超时，请稍后重试');
}
export async function ensureFork(repoFullName) {
    const octokit = getOctokit();
    const account = getAccount();
    const upstream = splitRepoFullName(repoFullName);
    const upstreamRepo = await octokit.rest.repos.get({
        owner: upstream.owner,
        repo: upstream.repo
    });
    const defaultBranch = upstreamRepo.data.default_branch;
    try {
        const { data: forkRepo } = await octokit.rest.repos.get({
            owner: account.login,
            repo: upstream.repo
        });
        if (forkRepo.parent?.full_name === repoFullName) {
            return {
                upstream,
                fork: { owner: account.login, repo: upstream.repo },
                defaultBranch,
                token: account.token
            };
        }
    }
    catch (error) {
        // Ignore 404 and create fork below.
    }
    await octokit.rest.repos.createFork({
        owner: upstream.owner,
        repo: upstream.repo
    });
    await waitForkReady(octokit, account.login, upstream.repo);
    return {
        upstream,
        fork: { owner: account.login, repo: upstream.repo },
        defaultBranch,
        token: account.token
    };
}
async function getRepoBranchContext(repoFullName) {
    const octokit = getOctokit();
    const account = getAccount();
    const target = splitRepoFullName(repoFullName);
    const { data } = await octokit.rest.repos.get({
        owner: target.owner,
        repo: target.repo
    });
    return {
        owner: target.owner,
        repo: target.repo,
        defaultBranch: data.default_branch,
        token: account.token
    };
}
export function buildBranchName(issueNumber, issueTitle) {
    return buildTaskBranchName({
        source: 'issue',
        issueNumber,
        issueTitle
    });
}
const BRANCH_MAX_LENGTH = 60;
function isRefAlreadyExistsError(error) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const maybe = error;
    return (maybe.status === 422 &&
        typeof maybe.message === 'string' &&
        maybe.message.toLowerCase().includes('reference already exists'));
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function parseIssueBranch(baseName, branchName) {
    if (branchName === baseName) {
        return { name: branchName, revision: 1 };
    }
    const revisionMatch = branchName.match(new RegExp(`^${escapeRegExp(baseName)}-r(\\d+)$`));
    if (revisionMatch) {
        const revision = Number(revisionMatch[1]);
        if (Number.isFinite(revision) && revision > 1) {
            return { name: branchName, revision };
        }
    }
    if (branchName.startsWith(`${baseName}-`)) {
        // Legacy branch naming from older releases.
        return { name: branchName };
    }
    return undefined;
}
function buildRevisionBranchName(baseName, revision) {
    if (revision <= 1) {
        return baseName;
    }
    const suffix = `-r${revision}`;
    const maxBaseLength = BRANCH_MAX_LENGTH - suffix.length;
    const trimmed = baseName.slice(0, Math.max(1, maxBaseLength)).replace(/-+$/g, '');
    return `${trimmed}${suffix}`;
}
function sortIssueBranches(branches) {
    return [...branches].sort((a, b) => {
        const aRevision = a.revision ?? 0;
        const bRevision = b.revision ?? 0;
        if (aRevision !== bRevision) {
            return bRevision - aRevision;
        }
        return b.name.localeCompare(a.name);
    });
}
async function listIssueBranches(context, baseName) {
    const octokit = getOctokit();
    const { data } = await octokit.rest.git.listMatchingRefs({
        owner: context.fork.owner,
        repo: context.fork.repo,
        ref: `heads/${baseName}`
    });
    const map = new Map();
    data.forEach((item) => {
        if (!item.ref.startsWith('refs/heads/')) {
            return;
        }
        const name = item.ref.replace(/^refs\/heads\//, '');
        const parsed = parseIssueBranch(baseName, name);
        if (!parsed) {
            return;
        }
        map.set(parsed.name, parsed);
    });
    return sortIssueBranches(Array.from(map.values()));
}
async function hasOpenPullRequestForBranch(context, branchName) {
    const octokit = getOctokit();
    const { data } = await octokit.rest.pulls.list({
        owner: context.upstream.owner,
        repo: context.upstream.repo,
        state: 'open',
        head: `${context.fork.owner}:${branchName}`,
        base: context.defaultBranch,
        per_page: 1
    });
    return data.length > 0;
}
async function hasAnyPullRequestForBranch(context, branchName) {
    const octokit = getOctokit();
    const { data } = await octokit.rest.pulls.list({
        owner: context.upstream.owner,
        repo: context.upstream.repo,
        state: 'all',
        head: `${context.fork.owner}:${branchName}`,
        base: context.defaultBranch,
        per_page: 1
    });
    return data.length > 0;
}
async function createBranchRef(context, branchName, commitSha) {
    const octokit = getOctokit();
    try {
        await octokit.rest.git.createRef({
            owner: context.owner,
            repo: context.repo,
            ref: `refs/heads/${branchName}`,
            sha: commitSha
        });
        return true;
    }
    catch (error) {
        if (isRefAlreadyExistsError(error)) {
            return false;
        }
        const message = error instanceof Error ? error.message : '创建分支失败，请检查仓库权限与默认分支配置';
        throw new Error(message);
    }
}
export async function createBranchForIssue(context, issueNumber, issueTitle) {
    return createBranchForTask(context, {
        source: 'issue',
        issueNumber,
        issueTitle
    });
}
export function buildTaskBranchName(params) {
    const slug = params.issueTitle
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    const base = params.source === 'local'
        ? `gitagent/local-${slug || 'task'}`
        : `gitagent/issue-${params.issueNumber ?? 0}-${slug || 'task'}`;
    return base.slice(0, 60);
}
export async function createBranchForTask(context, params) {
    const octokit = getOctokit();
    const baseBranch = context.defaultBranch;
    const { data: branchData } = await octokit.rest.repos.getBranch({
        owner: context.fork.owner,
        repo: context.fork.repo,
        branch: baseBranch
    });
    const baseName = buildTaskBranchName(params);
    const existingBranches = await listIssueBranches(context, baseName);
    // 1) Reuse the branch with an open PR first.
    for (const branch of existingBranches) {
        if (await hasOpenPullRequestForBranch(context, branch.name)) {
            return branch.name;
        }
    }
    // 2) Reuse branches that have never opened a PR (likely ongoing WIP).
    for (const branch of existingBranches) {
        if (!(await hasAnyPullRequestForBranch(context, branch.name))) {
            return branch.name;
        }
    }
    // 3) No reusable branch, create a new revision branch.
    if (existingBranches.length === 0) {
        const created = await createBranchRef(context.fork, baseName, branchData.commit.sha);
        if (created) {
            return baseName;
        }
    }
    const maxRevision = existingBranches.reduce((max, branch) => {
        const revision = branch.revision ?? 1;
        return Math.max(max, revision);
    }, 1);
    for (let revision = maxRevision + 1; revision <= maxRevision + 10; revision += 1) {
        const branchName = buildRevisionBranchName(baseName, revision);
        const created = await createBranchRef(context.fork, branchName, branchData.commit.sha);
        if (created) {
            return branchName;
        }
    }
    throw new Error('创建分支失败，请稍后重试');
}
export async function ensureDirectBranch(repoFullName, branchName) {
    const octokit = getOctokit();
    const context = await getRepoBranchContext(repoFullName);
    try {
        await octokit.rest.repos.getBranch({
            owner: context.owner,
            repo: context.repo,
            branch: branchName
        });
        return context;
    }
    catch (error) {
        const maybe = error;
        if (maybe.status !== 404) {
            throw error;
        }
    }
    const { data: baseBranch } = await octokit.rest.repos.getBranch({
        owner: context.owner,
        repo: context.repo,
        branch: context.defaultBranch
    });
    const created = await createBranchRef(context, branchName, baseBranch.commit.sha);
    if (!created) {
        return context;
    }
    return context;
}
export function buildBranchUrl(repoFullName, branchName) {
    return `https://github.com/${repoFullName}/tree/${encodeURIComponent(branchName)}`;
}
export async function fetchReadmeHead(repoFullName) {
    const octokit = getOctokit();
    const { owner, repo } = splitRepoFullName(repoFullName);
    try {
        const { data } = await octokit.rest.repos.getReadme({ owner, repo });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return content.split('\n').slice(0, 500).join('\n');
    }
    catch {
        return '';
    }
}
export async function createPullRequest(params) {
    const octokit = getOctokit();
    const existing = await octokit.rest.pulls.list({
        owner: params.context.upstream.owner,
        repo: params.context.upstream.repo,
        state: 'open',
        head: `${params.context.fork.owner}:${params.branchName}`,
        base: params.context.defaultBranch,
        per_page: 1
    });
    if (existing.data.length > 0) {
        return {
            number: existing.data[0].number,
            url: existing.data[0].html_url,
            existed: true
        };
    }
    const source = params.source ?? 'issue';
    const titlePrefix = params.taskType === 'feature' ? 'Feat' : 'Fix';
    const title = source === 'local'
        ? `[GitAgent] ${titlePrefix}: ${params.issueTitle}`.slice(0, 120)
        : `[GitAgent] ${titlePrefix}: #${params.issueNumber} ${params.issueTitle}`.slice(0, 120);
    const body = [
        '## 修复说明',
        params.summary.trim() || '由 GitAgent Desktop MVP 自动生成',
        '',
        ...(source === 'local'
            ? ['## 任务来源', '本次改动来自 BuildBot Desktop 的本地录入任务。']
            : ['## 关联 Issue', `Closes #${params.issueNumber}`]),
        '',
        '## 变更文件列表',
        ...params.changedFiles.map((file) => `- ${file}`),
        '',
        '---',
        '*本 PR 由 GitAgent Desktop 自动生成*'
    ].join('\n');
    const { data } = await octokit.rest.pulls.create({
        owner: params.context.upstream.owner,
        repo: params.context.upstream.repo,
        title,
        head: `${params.context.fork.owner}:${params.branchName}`,
        base: params.context.defaultBranch,
        body
    });
    return {
        number: data.number,
        url: data.html_url,
        existed: false
    };
}
