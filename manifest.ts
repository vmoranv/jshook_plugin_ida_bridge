import {
  assertLoopbackUrl,
  requestJson,
  toErrorResponse,
  toTextResponse,
} from '@jshookmcp/extension-sdk/bridges';
import {
  createExtension,
} from '@jshookmcp/extension-sdk/plugin';
import type { ToolArgs, PluginLifecycleContext } from '@jshookmcp/extension-sdk/plugin';

const PLUGIN_SLUG = 'ida-bridge';

function getPluginBooleanConfig(
  ctx: PluginLifecycleContext,
  slug: string,
  key: string,
  fallback: boolean,
): boolean {
  const value = ctx.getConfig(`plugins.${slug}.${key}`, fallback);
  return typeof value === 'boolean' ? value : fallback;
}

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

async function handleIdaBridge(args: ToolArgs) {
  const endpoint = assertLoopbackUrl(
    process.env.IDA_BRIDGE_URL ?? 'http://127.0.0.1:18081',
    'IDA_BRIDGE_URL',
  );
  const action = typeof args.action === 'string' ? args.action : '';
  if (!action) return toErrorResponse('ida_bridge', new Error('action is required'));

  try {
    switch (action) {
      case 'status': {
        const { status, data } = await requestBridge(endpoint, '/health');
        return toTextResponse({ success: status < 300, action, status, data, endpoint });
      }
      case 'open_binary': {
        const binaryPath = typeof args.binaryPath === 'string' ? args.binaryPath : '';
        if (!binaryPath) throw new Error('binaryPath is required for open_binary');
        const { status, data } = await requestBridge(endpoint, '/binary/open', 'POST', { binaryPath });
        return toTextResponse({ success: status < 300, action, status, result: data });
      }
      case 'list_functions': {
        const { status, data } = await requestBridge(endpoint, '/functions');
        return toTextResponse({ success: status < 300, action, status, functions: data });
      }
      case 'decompile_function': {
        const functionName = typeof args.functionName === 'string' ? args.functionName : '';
        if (!functionName) throw new Error('functionName is required for decompile_function');
        const { status, data } = await requestBridge(
          endpoint,
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
        const { status, data } = await requestBridge(endpoint, '/script/run', 'POST', {
          scriptPath,
          args: scriptArgs,
        });
        return toTextResponse({ success: status < 300, action, status, result: data });
      }
      case 'get_xrefs': {
        const functionName = typeof args.functionName === 'string' ? args.functionName : '';
        if (!functionName) throw new Error('functionName is required for get_xrefs');
        const { status, data } = await requestBridge(
          endpoint,
          `/xrefs/${encodeURIComponent(functionName)}`,
        );
        return toTextResponse({ success: status < 300, action, status, symbol: functionName, xrefs: data });
      }
      case 'get_strings': {
        const { status, data } = await requestBridge(endpoint, '/strings');
        return toTextResponse({ success: status < 300, action, status, strings: data });
      }
      default:
        return toTextResponse({
          success: true,
          guide: {
            actions: ['status', 'open_binary', 'list_functions', 'decompile_function', 'run_script', 'get_xrefs', 'get_strings'],
            endpoint,
          },
        });
    }
  } catch (error) {
    return toErrorResponse('ida_bridge', error, { action, endpoint });
  }
}

export default createExtension('io.github.vmoranv.ida-bridge', '0.1.0')
  .compatibleCore('>=0.1.0')
  .profile(['full'])
  .allowHost(['127.0.0.1', 'localhost', '::1'])
  .allowTool('ida_bridge')
  .configDefault('plugins.ida-bridge.enabled', true)
  .metric('ida_bridge_calls_total')
  .tool(
    'ida_bridge',
    'Interact with IDA bridge backend. Actions: status, open_binary, list_functions, decompile_function, run_script, get_xrefs, get_strings.',
    {
      action: { type: 'string', enum: ['status', 'open_binary', 'list_functions', 'decompile_function', 'run_script', 'get_xrefs', 'get_strings'] },
      binaryPath: { type: 'string' },
      functionName: { type: 'string' },
      scriptPath: { type: 'string' },
      scriptArgs: { type: 'array', items: { type: 'string' } },
    },
    async (args) => handleIdaBridge(args),
  )
  .onLoad((ctx) => { ctx.setRuntimeData('loadedAt', new Date().toISOString()); })
  .onValidate((ctx: PluginLifecycleContext) => {
    const enabled = getPluginBooleanConfig(ctx, 'ida-bridge', 'enabled', true);
    if (!enabled) return { valid: false, errors: ['Plugin disabled by config'] };
    return { valid: true, errors: [] };
  });
