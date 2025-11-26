/**
 * Type definitions for Zekt Action
 */
export interface RegisterRunRequest {
    zekt_run_id: number;
    zekt_step_id: string;
    zekt_payload: unknown;
    github_context: GitHubContext;
}
export interface GitHubContext {
    repository: string;
    workflow: string;
    job: string;
    actor: string;
    event_name: string;
    ref: string;
    sha: string;
}
export interface ActionInputs {
    zektRunId: number;
    zektStepId: string;
    zektPayload: string;
    githubToken: string;
}
export interface ZektApiResponse {
    success: boolean;
    run_id?: number;
    step_id?: string;
    message?: string;
    error?: string;
}
export interface PayloadValidationResult {
    valid: boolean;
    sizeBytes: number;
    warning?: string;
}
