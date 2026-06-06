/**
 * Stdin reader utility module for the Claude SDK bridge.
 */

/**
 * Read JSON data from stdin.
 * @param {string} provider - 'claude' (kept for API compatibility, unused)
 * @returns {Promise<Object|null>} The parsed JSON object, or null
 */
export async function readStdinData(provider = 'claude') {
  if (process.env.CLAUDE_USE_STDIN !== 'true') {
    return null;
  }

  return new Promise((resolve) => {
    let data = '';
    const stdin = process.stdin;

    stdin.setEncoding('utf8');

    // Cleanup: remove all listeners and stop reading
    const cleanup = () => {
      stdin.removeListener('readable', onReadable);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      stdin.pause();
    };

    // Set a timeout to avoid waiting indefinitely
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 5000);

    const onReadable = () => {
      let chunk;
      while ((chunk = stdin.read()) !== null) {
        data += chunk;
      }
    };

    const onEnd = () => {
      clearTimeout(timeout);
      cleanup();
      if (data.trim()) {
        try {
          const parsed = JSON.parse(data.trim());
          resolve(parsed);
        } catch (e) {
          console.error('[STDIN_PARSE_ERROR]', e.message);
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };

    const onError = (err) => {
      clearTimeout(timeout);
      cleanup();
      console.error('[STDIN_ERROR]', err.message);
      resolve(null);
    };

    stdin.on('readable', onReadable);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
  });
}
