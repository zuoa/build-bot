import { getAccount, getOctokit } from './client';
const FORK_TIMEOUT_MS = 60_000;
const FORK_POLL_INTERVAL_MS = 3_000;
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
export function buildBranchName(issueNumber, issueTitle) {
    const slug = issueTitle
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    const base = `gitagent/issue-${issueNumber}-${slug || 'task'}`;
    return base.slice(0, 60);
}
export async function createBranchForIssue(context, issueNumber, issueTitle) {
    const octokit = getOctokit();
    const baseBranch = context.defaultBranch;
    const { data: branchData } = await octokit.rest.repos.getBranch({
        owner: context.fork.owner,
        repo: context.fork.repo,
        branch: baseBranch
    });
    const originalName = buildBranchName(issueNumber, issueTitle);
    let branchName = originalName;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            await octokit.rest.git.createRef({
                owner: context.fork.owner,
                repo: context.fork.repo,
                ref: `refs/heads/${branchName}`,
                sha: branchData.commit.sha
            });
            return branchName;
        }
        catch (error) {
            const suffix = new Date()
                .toISOString()
                .replace(/[-:TZ.]/g, '')
                .slice(0, 12);
            branchName = `${originalName}-${suffix}`.slice(0, 60);
        }
    }
    throw new Error('创建分支失败，请稍后重试');
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
    const titlePrefix = params.taskType === 'feature' ? 'Feat' : 'Fix';
    const title = `[GitAgent] ${titlePrefix}: #${params.issueNumber} ${params.issueTitle}`.slice(0, 120);
    const body = [
        '## 修复说明',
        params.summary.trim() || '由 GitAgent Desktop MVP 自动生成',
        '',
        '## 关联 Issue',
        `Closes #${params.issueNumber}`,
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
