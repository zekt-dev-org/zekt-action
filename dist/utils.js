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
exports.getActionInputs = getActionInputs;
exports.extractWorkflowPath = extractWorkflowPath;
const core = __importStar(require("@actions/core"));
/**
 * Get and validate action inputs
 */
function getActionInputs() {
    const eventType = core.getInput('event-type', { required: true });
    const payload = core.getInput('payload', { required: false }) || '{}';
    const zektApiUrl = core.getInput('zekt-api-url', { required: false }) ||
        'https://fxdevzektapp.azurewebsites.net';
    const shieldInput = core.getInput('shield', { required: false });
    // Parse boolean (handles 'true', 'false', '', etc.)
    const shield = shieldInput === 'true';
    return {
        eventType,
        payload,
        zektApiUrl,
        shield,
    };
}
/**
 * Extract workflow path from GitHub context
 * Example: "owner/repo/.github/workflows/deploy.yml@refs/heads/main"
 * Returns: ".github/workflows/deploy.yml"
 */
function extractWorkflowPath(context) {
    // Use workflow_ref if available (GitHub Actions context)
    // @ts-ignore - workflow_ref exists in runtime context but not in types
    const workflowRef = context.workflow_ref || '';
    // Format: owner/repo/.github/workflows/file.yml@ref
    const match = workflowRef.match(/\.github\/workflows\/[^@]+/);
    if (match) {
        return match[0];
    }
    // Fallback: use workflow name
    core.warning(`Could not extract workflow path from workflow_ref: ${workflowRef}. ` +
        `Using workflow name instead.`);
    return `.github/workflows/${context.workflow}.yml`;
}
//# sourceMappingURL=utils.js.map