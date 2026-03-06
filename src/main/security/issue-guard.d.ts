import type { IssueDetail } from '../../shared/types';
export declare const HUMAN_CONFIRMATION_LABEL = "needs-human-confirmation";
export interface IssueRiskAssessment {
    blocked: boolean;
    reasons: string[];
    score: number;
}
export declare function assessIssueRisk(issue: IssueDetail): IssueRiskAssessment;
export declare function buildHumanConfirmationComment(reasons: string[]): string;
