/**
 * Validation functions for Zekt Action
 */
import { ActionInputs, PayloadValidationResult } from './types';
/**
 * Validate payload size with warning at 80% threshold
 */
export declare function validatePayloadSize(payload: string): PayloadValidationResult;
/**
 * Validate JSON structure
 */
export declare function validateJSON(payload: string): unknown;
/**
 * Validate required inputs
 */
export declare function validateInputs(inputs: ActionInputs): void;
