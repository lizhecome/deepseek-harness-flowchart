/** Package-owned invariant companion for the flowchart bundle. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "flowchart-invariant";
export declare const inject: string[];
/** Register package ownership with the Harness invariant registry. */
export declare const apply: (ctx: Context) => Promise<() => void>;
