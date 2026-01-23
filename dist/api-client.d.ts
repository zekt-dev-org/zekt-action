import { EventRequest, EventResponse } from './types';
/**
 * Send event to Zekt backend
 */
export declare function sendEvent(apiUrl: string, oidcToken: string, eventRequest: EventRequest): Promise<EventResponse>;
