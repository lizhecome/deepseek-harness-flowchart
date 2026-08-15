/**
 * Beautiful Mermaid flowchart rendering for DeepSeek Harness.
 *
 * @module @lizhecome/dsh-flowchart
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "flowchart";
export declare const inject: string[];
/** Theme names deliberately exposed to the model-facing schema. */
export declare const THEME_NAMES: readonly ["zinc-light", "zinc-dark", "tokyo-night", "tokyo-night-storm", "tokyo-night-light", "catppuccin-mocha", "catppuccin-latte", "nord", "nord-light", "dracula", "github-light", "github-dark", "solarized-light", "solarized-dark", "one-dark"];
export type ThemeName = typeof THEME_NAMES[number];
/** Deployment bounds and default appearance for the rendering tool. */
export interface Config {
    /** Theme used when a call omits `theme`. */
    defaultTheme?: ThemeName;
    /** Maximum Mermaid source length accepted by one call. */
    maxSourceChars?: number;
    /** Maximum complete UTF-8 SVG size passed to the write tool. */
    maxSvgBytes?: number;
}
export declare const Config: z<Config>;
/** Install the model-facing rendering tool. */
export declare function apply(ctx: Context, config: Config): void;
