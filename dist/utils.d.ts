import { Context } from '@actions/github/lib/context';
import { ActionInputs, OrchestrationStepRef } from './types';
/**
 * Get and validate action inputs
 */
export declare function getActionInputs(): ActionInputs;
/**
 * Reads orchestration_step_ref from the GitHub event file when running inside
 * a repository_dispatch-triggered workflow that is part of an orchestration.
 * Returns null for all standard (non-orchestrated) runs.
 */
export declare function readOrchestrationStepRef(): OrchestrationStepRef | null;
/**
 * Extract workflow path from GitHub context
 * Example: "owner/repo/.github/workflows/deploy.yml@refs/heads/main"
 * Returns: ".github/workflows/deploy.yml"
 */
export declare function extractWorkflowPath(context: Context): string;
