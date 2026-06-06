/**
 * OpenCode channel command handler.
 *
 * Mirrors `claude-channel.js` so the entry-point contract in
 * `ai-bridge/channel-manager.js` stays consistent across providers. Only
 * the `send` command is implemented; the opencode provider does not
 * maintain a server-side session, expose tool/MCP/permission flows, or
 * support history replay. The `getSession`/`getMcpServerStatus`/etc.
 * commands are not registered.
 */
import { sendMessage as opencodeSendMessage } from '../services/opencode/message-service.js';

/**
 * Execute an opencode-specific command.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object|null} stdinData
 */
export async function handleOpencodeCommand(command, args, stdinData) {
  switch (command) {
    case 'send': {
      if (!stdinData || typeof stdinData !== 'object') {
        console.log(JSON.stringify({
          success: false,
          error: 'opencode send: missing stdin payload',
        }));
        return;
      }
      await opencodeSendMessage(stdinData);
      return;
    }

    default:
      throw new Error(`Unknown opencode command: ${command}`);
  }
}

export function getOpencodeCommandList() {
  return ['send'];
}
