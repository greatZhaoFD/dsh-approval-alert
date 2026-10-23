/**
 * dsh-approval-alert — host half.
 *
 * Deliberately a no-op: this package exists to be a live loader entry whose
 * manifest declares a `dsh.client` web bundle. The browser half (lib/client.js)
 * renders the frame-wide alert, plays the chime, and raises the OS notification.
 *
 * Keeping the host half inert means a future DSH host-side API change can at
 * worst make THIS package fail to mount; it cannot disturb the profile tree.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'approval-alert'

export const inject = []

export function apply(ctx) {
  // Pre-flight before the client-modules service scans this entry: if the
  // `dsh.client` manifest points at a bundle that is not actually there, the
  // modules service throws while constructing (a required entry), which can
  // stop DSH from starting. Failing this optional entry instead is contained:
  // the loader disables it with a warning and the rest of the profile boots.
  const clientFile = fileURLToPath(new URL('./client.js', import.meta.url))
  if (!existsSync(clientFile)) {
    throw new Error(`dsh-approval-alert: declared client bundle is missing at ${clientFile}; disable or reinstall this plugin`)
  }

  try {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('approval-alert') : undefined
    logger?.info?.('dsh-approval-alert loaded (client alert enabled)')
  } catch {
    // Logging must never break plugin loading.
  }
}
