import type { IssueDetail } from '../../shared/types';

export const HUMAN_CONFIRMATION_LABEL = 'needs-human-confirmation';

interface DetectionRule {
  pattern: RegExp;
  reason: string;
  severity: 'high' | 'medium';
}

export interface IssueRiskAssessment {
  blocked: boolean;
  reasons: string[];
  score: number;
}

const BLOCK_THRESHOLD = 80;

const DETECTION_RULES: DetectionRule[] = [
  {
    pattern:
      /(ignore|override|bypass|disable|forget|忽略|绕过|无视|覆盖).{0,40}(instruction|system|prompt|rule|policy|guardrail|限制|约束|系统提示|安全规则)/i,
    reason: '包含试图绕过代理约束的提示注入语句',
    severity: 'high'
  },
  {
    pattern:
      /\b(token|secret|password|api(?:_| )?key|private key|ssh key|credential|cookie|session|access key|密钥|令牌|密码|凭证|私钥)\b.{0,60}\b(show|print|dump|export|upload|send|share|post|expose|泄露|导出|上传|发送|打印)\b/i,
    reason: '包含读取或外传敏感信息的指令',
    severity: 'high'
  },
  {
    pattern:
      /\b(show|print|dump|list|cat|find)\b.{0,40}\b(env|environment|secret|token|password|credential|api(?:_| )?key|\.env|ssh|cookie|session|环境变量|密钥|令牌|密码|凭证)\b/i,
    reason: '包含探测环境变量或凭据的指令',
    severity: 'high'
  },
  {
    pattern:
      /\b(rm\s+-rf|sudo\b|chmod\s+777|chown\b|mkfs\b|dd\s+if=|shutdown\b|reboot\b|poweroff\b|git\s+reset\s+--hard|git\s+clean\s+-fdx)\b/i,
    reason: '包含明显破坏性的系统或 Git 命令',
    severity: 'high'
  },
  {
    pattern:
      /(?:\b(curl|wget|nc|netcat|scp|ssh)\b.{0,80}\b(http|https|ftp|webhook|slack|discord|telegram|外部|远程)\b)|(?:\|\s*(sh|bash)\b)/i,
    reason: '包含外部网络传输或远程脚本执行指令',
    severity: 'high'
  },
  {
    pattern:
      /(\/etc\/passwd|\/etc\/shadow|~\/\.ssh|\.npmrc|\.git\/config|aws_access_key_id|aws_secret_access_key|gh[pousr]_[a-z0-9_]+)/i,
    reason: '包含高敏感路径或凭据特征',
    severity: 'medium'
  },
  {
    pattern:
      /\b(base64\b.{0,20}\b(decode|decode64)|powershell\s+-enc|eval\s*\(|exec\s*\(|child_process|shell\s+script)\b/i,
    reason: '包含混淆执行或命令执行载荷特征',
    severity: 'medium'
  }
];

function buildInspectionText(issue: IssueDetail): string {
  return [
    issue.title,
    issue.body,
    ...issue.comments.map((comment) => comment.body)
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

export function assessIssueRisk(issue: IssueDetail): IssueRiskAssessment {
  if (issue.labels.some((label) => label.name === HUMAN_CONFIRMATION_LABEL)) {
    return {
      blocked: true,
      reasons: ['该 Issue 已被标记为需要人工确认'],
      score: 100
    };
  }

  const inspectionText = buildInspectionText(issue);
  const matchedReasons = new Set<string>();
  let score = 0;

  DETECTION_RULES.forEach((rule) => {
    if (!rule.pattern.test(inspectionText)) {
      return;
    }
    matchedReasons.add(rule.reason);
    score += rule.severity === 'high' ? 100 : 40;
  });

  return {
    blocked: score >= BLOCK_THRESHOLD,
    reasons: Array.from(matchedReasons),
    score
  };
}

export function buildHumanConfirmationComment(reasons: string[]): string {
  const lines = reasons.length > 0 ? reasons : ['命中了 BuildBot 的高风险执行规则'];
  return [
    '<!-- buildbot-security-review -->',
    'BuildBot 在执行前检测到该 Issue 含有疑似恶意或高风险指令，已暂停自动执行并转为人工确认。',
    '',
    '命中原因：',
    ...lines.map((reason) => `- ${reason}`),
    '',
    `系统已自动添加 \`${HUMAN_CONFIRMATION_LABEL}\` 标记。请维护者人工复核后再决定是否继续执行。`
  ].join('\n');
}
