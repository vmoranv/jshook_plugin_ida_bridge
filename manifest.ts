import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  assertLoopbackUrl,
  requestJson,
  toErrorResponse,
  toTextResponse,
  type TextToolResponse,
} from '@jshookmcp/extension-sdk/bridges';
import { getPluginBooleanConfig, loadPluginEnv } from '@jshookmcp/extension-sdk/plugin';
import type {
  DomainManifest,
  PluginContract,
  PluginLifecycleContext,
  ToolArgs,
  ToolHandlerDeps,
} from '@jshookmcp/extension-sdk/plugin';

type HandlerMap = Record<string, (args: ToolArgs) => Promise<unknown>>;

loadPluginEnv(import.meta.url);

async function requestBridge(
  endpoint: string,
  path: string,
  method = 'GET',
  body?: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const { status, data } = await requestJson(
    `${endpoint.replace(/\/$/, '')}${path}`,
    method,
    body,
  );
  return { status, data };
}

class IdaBridgeHandlers {
  constructor(private readonly endpoint: string) {}

  async handleIdaBridge(args: ToolArgs): Promise<TextToolResponse> {
    const action = typeof args.action === 'string' ? args.action : '';
    if (!action) return toErrorResponse('ida_bridge', new Error('action is required'));

    try {
      switch (action) {
        case 'status': {
          const { status, data } = await requestBridge(this.endpoint, '/health');
          return toTextResponse({ success: status < 300, action, status, data, endpoint: this.endpoint });
        }
        case 'open_binary': {
          const binaryPath = typeof args.binaryPath === 'string' ? args.binaryPath : '';
          if (!binaryPath) throw new Error('binaryPath is required for open_binary');
          const { status, data } = await requestBridge(this.endpoint, '/binary/open', 'POST', { binaryPath });
          return toTextResponse({ success: status < 300, action, status, result: data });
        }
        case 'list_functions': {
          const { status, data } = await requestBridge(this.endpoint, '/functions');
          return toTextResponse({ success: status < 300, action, status, functions: data });
        }
        case 'decompile_function': {
          const functionName = typeof args.functionName === 'string' ? args.functionName : '';
          if (!functionName) throw new Error('functionName is required for decompile_function');
          const { status, data } = await requestBridge(
            this.endpoint,
            `/functions/${encodeURIComponent(functionName)}/decompile`,
          );
          return toTextResponse({ success: status < 300, action, status, functionName, decompiled: data });
        }
        case 'run_script': {
          const scriptPath = typeof args.scriptPath === 'string' ? args.scriptPath : '';
          if (!scriptPath) throw new Error('scriptPath is required for run_script');
          const scriptArgs = Array.isArray(args.scriptArgs)
            ? (args.scriptArgs as unknown[]).filter((item): item is string => typeof item === 'string')
            : [];
          const { status, data } = await requestBridge(this.endpoint, '/script/run', 'POST', {
            scriptPath,
            args: scriptArgs,
          });
          return toTextResponse({ success: status < 300, action, status, result: data });
        }
        case 'get_xrefs': {
          const functionName = typeof args.functionName === 'string' ? args.functionName : '';
          if (!functionName) throw new Error('functionName is required for get_xrefs');
          const { status, data } = await requestBridge(
            this.endpoint,
            `/xrefs/${encodeURIComponent(functionName)}`,
          );
          return toTextResponse({ success: status < 300, action, status, symbol: functionName, xrefs: data });
        }
        case 'get_strings': {
          const { status, data } = await requestBridge(this.endpoint, '/strings');
          return toTextResponse({ success: status < 300, action, status, strings: data });
        }
        default:
          return toTextResponse({
            success: true,
            guide: {
              actions: [
                'status',
                'open_binary',
                'list_functions',
                'decompile_function',
                'run_script',
                'get_xrefs',
                'get_strings',
              ],
              endpoint: this.endpoint,
            },
          });
      }
    } catch (error) {
      return toErrorResponse('ida_bridge', error, { action, endpoint: this.endpoint });
    }
  }
}

const tools: Tool[] = [
  {
    name: 'ida_bridge',
    description:
      'Interact with IDA bridge backend. Actions: status, open_binary, list_functions, decompile_function, run_script, get_xrefs, get_strings.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'open_binary',
            'list_functions',
            'decompile_function',
            'run_script',
            'get_xrefs',
            'get_strings',
          ],
        },
        binaryPath: { type: 'string' },
        functionName: { type: 'string' },
        scriptPath: { type: 'string' },
        scriptArgs: { type: 'array', items: { type: 'string' } },
      },
      required: ['action'],
    },
  },
];

const DEP_KEY = 'idaBridgeHandlers';
const DOMAIN = 'ida-bridge';

function bind(methodName: string) {
  return (deps: ToolHandlerDeps) => async (args: ToolArgs) => {
    const handlers = deps[DEP_KEY] as HandlerMap;
    const method = handlers[methodName];
    if (typeof method !== 'function') {
      throw new Error(`Missing ida handler method: ${methodName}`);
    }
    return method(args ?? {});
  };
}

const domainManifest: DomainManifest = {
  kind: 'domain-manifest',
  version: 1,
  domain: DOMAIN,
  depKey: DEP_KEY,
  profiles: ['full', 'reverse'],
  ensure() {
    const endpoint = assertLoopbackUrl(
      process.env.IDA_BRIDGE_URL ?? 'http://127.0.0.1:18081',
      'IDA_BRIDGE_URL',
    );
    return new IdaBridgeHandlers(endpoint);
  },
  registrations: [
    {
      tool: tools[0]!,
      domain: DOMAIN,
      bind: bind('handleIdaBridge'),
    },
  ],
};

const plugin: PluginContract = {
  manifest: {
    kind: 'plugin-manifest',
    version: 1,
    id: 'io.github.vmoranv.ida-bridge',
    name: 'IDA Bridge',
    pluginVersion: '0.1.0',
    entry: 'manifest.js',
    description: 'Atomic IDA bridge plugin.',
    compatibleCore: '>=0.1.0',
    permissions: {
      network: { allowHosts: ['127.0.0.1', 'localhost', '::1'] },
      process: { allowCommands: [] },
      filesystem: { readRoots: [], writeRoots: [] },
      toolExecution: { allowTools: ['ida_bridge'] },
    },
    activation: {
      onStartup: false,
      profiles: ['full', 'reverse'],
    },
    contributes: {
      domains: [domainManifest],
      workflows: [],
      configDefaults: {
        'plugins.ida-bridge.enabled': true,
      },
      metrics: ['ida_bridge_calls_total'],
    },
  },
  onLoad(ctx: PluginLifecycleContext): void {
    ctx.setRuntimeData('loadedAt', new Date().toISOString());
  },
  onValidate(ctx: PluginLifecycleContext) {
    const enabled = getPluginBooleanConfig(ctx, 'ida-bridge', 'enabled', true);
    if (!enabled) return { valid: false, errors: ['Plugin disabled by config'] };
    return { valid: true, errors: [] };
  },
  onRegister(ctx: PluginLifecycleContext): void {
    ctx.registerDomain(domainManifest);
    ctx.registerMetric('ida_bridge_calls_total');
  },
};

export default plugin;
