"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const utils_1 = require("./utils");
const shield_1 = require("./shield");
const api_client_1 = require("./api-client");
async function run() {
    try {
        // 1. Get inputs
        const inputs = (0, utils_1.getActionInputs)();
        core.info(`Event Type: ${inputs.eventType}`);
        core.info(`Shield: ${inputs.shield}`);
        // 2. Get OIDC token
        const oidcToken = await core.getIDToken('api://zekt');
        core.setSecret(oidcToken);
        core.info('✅ OIDC token obtained');
        // 3. Parse payload
        let payloadObject;
        try {
            payloadObject = JSON.parse(inputs.payload);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Invalid JSON payload: ${errorMessage}`);
        }
        // 4. Shield encryption (if enabled)
        let finalPayload = payloadObject;
        if (inputs.shield) {
            core.info('🛡️ Shield encryption enabled');
            // Get consumer keys
            const consumerKeys = await (0, shield_1.getConsumerKeys)(inputs.zektApiUrl, oidcToken, github.context.repo.owner + '/' + github.context.repo.repo);
            core.info(`📋 Retrieved ${consumerKeys.length} consumer keys`);
            if (consumerKeys.length === 0) {
                throw new Error('Shield encryption failed: No consumers found. ' +
                    'Ensure at least one consumer is subscribed to this provider.');
            }
            // Encrypt payload
            finalPayload = await (0, shield_1.encryptPayload)(payloadObject, consumerKeys);
            core.info('✅ Payload encrypted successfully');
        }
        // 5. Build event request
        const eventRequest = {
            eventType: inputs.eventType,
            repository: github.context.repo.owner + '/' + github.context.repo.repo,
            workflowRunId: github.context.runId.toString(),
            triggeredBy: github.context.actor,
            commitSha: github.context.sha,
            ref: github.context.ref,
            workflow: github.context.workflow,
            payload: finalPayload,
            timestamp: new Date().toISOString(),
        };
        // 6. Send to Zekt
        const response = await (0, api_client_1.sendEvent)(inputs.zektApiUrl, oidcToken, eventRequest);
        // 7. Set outputs
        core.setOutput('event-id', response.eventId || '');
        core.setOutput('status', response.success ? 'success' : 'failed');
        core.setOutput('consumers-notified', response.consumersNotified || 0);
        // 8. Write job summary
        await writeJobSummary(inputs, response, inputs.shield);
        core.info('✅ Event sent successfully');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        core.error(`❌ Failed: ${errorMessage}`);
        throw error;
    }
}
async function writeJobSummary(inputs, response, shieldEnabled) {
    await core.summary
        .addHeading('Zekt Event Delivery')
        .addTable([
        [
            { data: 'Property', header: true },
            { data: 'Value', header: true },
        ],
        ['Event Type', inputs.eventType],
        [
            'Repository',
            github.context.repo.owner + '/' + github.context.repo.repo,
        ],
        ['Workflow', github.context.workflow],
        ['Run ID', github.context.runId.toString()],
        ['Shield', shieldEnabled ? '🛡️ Enabled' : 'Disabled'],
        ['Status', response.success ? '✅ Success' : '❌ Failed'],
        ['Event ID', response.eventId || 'N/A'],
        ['Consumers Notified', (response.consumersNotified || 0).toString()],
    ])
        .addRaw('<hr>')
        .addRaw('_Sent via [Zekt Action](https://github.com/zekt-dev-org/zekt-action)_')
        .write();
}
//# sourceMappingURL=main.js.map