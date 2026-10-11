// The shared Jev client every tool here asks through. It owns the two checks that make a tool
// optional (a key in the environment, the SDK installed) and turns every failure into a value, so
// no tool ever throws into the caller's workflow. See README.md beside this file.
//
// `available()` checks the key and the SDK without a request; `ask` resolves to exactly one of:
//   { status: 'ok', answers }        answers keyed by question id, as the SDK returns them
//   { status: 'skipped', reason }    no TYPESAFE_API_KEY, or @typesafe-ai/sdk is not installed
//   { status: 'error', reason }      the request failed; `reason` is one line

import { MODEL } from './constants.mjs';

const KEY_VAR = 'TYPESAFE_API_KEY';

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]  where the key is read; default `process.env`
 * @param {() => Promise<object>} [options.importSdk]  loads the SDK; default a dynamic import, so a
 *   missing module is a skip rather than a crash at load time
 */
export function createClient({ env = process.env, importSdk = () => import('@typesafe-ai/sdk') } = {}) {
  let sdk = null;
  let sdkClient = null;

  /**
   * Whether a request could be made: a key is set and the SDK loads. Makes no request, so a tool
   * calls it before any other work (fetching an issue, reading docs) and stops on a skip.
   * Resolves to { status: 'ok' } or the same skipped/error shape `ask` uses.
   */
  async function available() {
    const key = env[KEY_VAR]?.trim();
    if (!key) return { status: 'skipped', reason: `${KEY_VAR} is not set` };
    if (sdk) return { status: 'ok' };
    try {
      sdk = await importSdk();
      return { status: 'ok' };
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') {
        return { status: 'skipped', reason: '@typesafe-ai/sdk is not installed (run pnpm install)' };
      }
      return { status: 'error', reason: errorLine(error, env) };
    }
  }

  async function ask({ state, questions }) {
    const ready = await available();
    if (ready.status !== 'ok') return ready;
    try {
      // logLevel 'off': the SDK's own retry warnings would break the one-line output contract.
      sdkClient ??= new sdk.TypeSafeClient({ apiKey: env[KEY_VAR].trim(), defaultModel: MODEL, logLevel: 'off' });
      const result = await sdkClient.systemOne({ state, questions, model: MODEL });
      return { status: 'ok', answers: result.answers };
    } catch (error) {
      return { status: 'error', reason: errorLine(error, env) };
    }
  }

  return { available, ask };
}

/**
 * The one way any Jev tool turns an error into its one-line reason: the first line of the message,
 * with the key from `env` redacted in case a message ever echoes it. Every tool and CLI uses this,
 * never its own copy.
 */
export function errorLine(error, env = process.env) {
  const line = String(error?.message ?? error).split('\n')[0];
  const key = env[KEY_VAR]?.trim();
  return key ? line.replaceAll(key, '[redacted]') : line;
}
