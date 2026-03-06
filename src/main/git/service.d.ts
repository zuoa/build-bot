import type { TaskType } from '../../shared/types';
import type { ForkContext } from '../github/service';
export declare function cloneBranchWorkspace(params: {
    context: ForkContext;
    branchName: string;
    issueNumber: number;
}): Promise<string>;
export declare function listChangedFiles(workspacePath: string): Promise<string[]>;
export declare function commitAndPush(params: {
    workspacePath: string;
    branchName: string;
    selectedFiles: string[];
    taskType: TaskType;
    issueTitle: string;
    issueNumber: number;
}): Promise<{
    commitSha: string;
}>;
export declare function cleanupWorkspace(workspacePath?: string): Promise<void>;
