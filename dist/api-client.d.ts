import { EventRequest, EventResponse, SubmitOrchestrationRequest, SubmitOrchestrationResponse, OrchestrationStatusResponse } from './types';
/**
 * Send event to Zekt backend
 */
export declare function sendEvent(apiUrl: string, oidcToken: string, eventRequest: EventRequest): Promise<EventResponse>;
/**
 * Submit an orchestration plan to Zekt backend
 */
export declare function submitOrchestration(apiUrl: string, oidcToken: string, repository: string, request: SubmitOrchestrationRequest): Promise<SubmitOrchestrationResponse>;
/**
 * Poll orchestration status until a terminal state is reached
 */
export declare function getOrchestrationStatus(apiUrl: string, oidcToken: string, repository: string, executionId: string): Promise<OrchestrationStatusResponse>;
