import type { TaskFileChange, TaskSource, TaskType } from '../../shared/types';
import type { ForkContext, RepoBranchContext } from '../github/service';
export declare function cloneBranchWorkspace(params: {
    context: ForkContext | RepoBranchContext;
    branchName: string;
    issueNumber: number;
    taskId: string;
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
}): Promise<string>;
export declare function listChangedFiles(workspacePath: string): Promise<string[]>;
export declare function buildTaskFileChanges(workspacePath: string, files: string[]): Promise<TaskFileChange[]>;
export declare function getFileDiffSummary(workspacePath: string, files: string[]): Promise<string>;
export declare function commitAndPush(params: {
    workspacePath: string;
    branchName: string;
    selectedFiles: string[];
    taskType: TaskType;
    issueTitle: string;
    issueNumber: number;
    source?: TaskSource;
}): Promise<{
    commitSha: string;
}>;
export declare function cleanupWorkspace(workspacePath?: string): Promise<void>;
