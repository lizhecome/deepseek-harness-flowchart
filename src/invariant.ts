/** Package-owned invariant companion for the flowchart bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@lizhecome/dsh-flowchart'

export const name = 'flowchart-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: the package owns one effect-scoped tool registration
 * and no mutable state; behavior tests prove registration disposal and the
 * rendered file/result agreement.
 */
const install: InvariantInstaller = () => {}

/** Register package ownership with the Harness invariant registry. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
