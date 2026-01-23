import { Context } from '@actions/github/lib/context';
import { ActionInputs } from './types';
/**
 * Get and validate action inputs
 */
export declare function getActionInputs(): ActionInputs;
/**
 * Extract workflow path from GitHub context
 * Example: "owner/repo/.github/workflows/deploy.yml@refs/heads/main"
 * Returns: ".github/workflows/deploy.yml"
 */
export declare function extractWorkflowPath(context: Context): string;
