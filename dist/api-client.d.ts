import { EventRequest, EventResponse, SubmitOrchestrationRequest, SubmitOrchestrationResponse, OrchestrationStatusResponse } from './types';
export declare function sendEvent(apiUrl: string, oidcToken: string, eventRequest: EventRequest): Promise<EventResponse>;
export declare function submitOrchestration(apiUrl: string, oidcToken: string, repository: string, request: SubmitOrchestrationRequest): Promise<SubmitOrchestrationResponse>;
export declare function getOrchestrationStatus(apiUrl: string, oidcToken: string, repository: string, executionId: string): Promise<OrchestrationStatusResponse>;
