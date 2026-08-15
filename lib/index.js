/**
 * Beautiful Mermaid flowchart rendering for DeepSeek Harness.
 *
 * @module @lizhecome/dsh-flowchart
 */
import { CallId } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import { renderMermaidSVG, THEMES } from 'beautiful-mermaid';
export const name = 'flowchart';
export const inject = ['tools'];
/** Theme names deliberately exposed to the model-facing schema. */
export const THEME_NAMES = [
    'zinc-light',
    'zinc-dark',
    'tokyo-night',
    'tokyo-night-storm',
    'tokyo-night-light',
    'catppuccin-mocha',
    'catppuccin-latte',
    'nord',
    'nord-light',
    'dracula',
    'github-light',
    'github-dark',
    'solarized-light',
    'solarized-dark',
    'one-dark',
];
export const Config = z.object({
    defaultTheme: z.union([...THEME_NAMES]).default('tokyo-night'),
    maxSourceChars: z.number().step(1).min(1).default(50_000),
    maxSvgBytes: z.number().step(1).min(1).default(2_000_000),
});
/** Validate configuration for Loader and same-process callers alike. */
function resolveConfig(config) {
    const defaultTheme = config.defaultTheme ?? 'tokyo-night';
    const maxSourceChars = config.maxSourceChars ?? 50_000;
    const maxSvgBytes = config.maxSvgBytes ?? 2_000_000;
    if (!THEME_NAMES.includes(defaultTheme)) {
        throw new Error(`flowchart: unknown default theme ${JSON.stringify(defaultTheme)}`);
    }
    if (!Number.isInteger(maxSourceChars) || maxSourceChars < 1) {
        throw new Error('flowchart: `maxSourceChars` must be a positive integer');
    }
    if (!Number.isInteger(maxSvgBytes) || maxSvgBytes < 1) {
        throw new Error('flowchart: `maxSvgBytes` must be a positive integer');
    }
    for (const theme of THEME_NAMES) {
        if (THEMES[theme] === undefined) {
            throw new Error(`flowchart: beautiful-mermaid does not provide configured theme ${JSON.stringify(theme)}`);
        }
    }
    return { defaultTheme, maxSourceChars, maxSvgBytes };
}
/** Resolve one optional integer layout value within its supported range. */
function layoutValue(value, fallback, min, max, field) {
    const resolved = value ?? fallback;
    if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
        throw new Error(`${field} must be an integer from ${min} through ${max}`);
    }
    return resolved;
}
/** Accept only flowchart/graph Mermaid documents and bounded SVG destinations. */
function parseArgs(args, config) {
    const source = args.source.trim();
    if (source.length === 0)
        throw new Error('source must not be blank');
    if (source.length > config.maxSourceChars) {
        throw new Error(`source exceeds the configured ${config.maxSourceChars}-character limit`);
    }
    const header = source.split(/\r?\n/, 1)[0]?.trim() ?? '';
    if (!/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/i.test(header)) {
        throw new Error('source must start with a Mermaid flowchart header such as `flowchart TD` or `graph LR`');
    }
    const filePath = args.file_path.trim();
    if (filePath.length === 0)
        throw new Error('file_path must not be blank');
    if (!filePath.toLowerCase().endsWith('.svg')) {
        throw new Error('file_path must end with `.svg`');
    }
    const theme = args.theme ?? config.defaultTheme;
    const colors = THEMES[theme];
    if (colors === undefined)
        throw new Error(`unknown theme ${JSON.stringify(theme)}`);
    return {
        source,
        filePath,
        theme,
        options: {
            ...colors,
            transparent: args.transparent ?? false,
            padding: layoutValue(args.padding, 40, 0, 200, 'padding'),
            nodeSpacing: layoutValue(args.node_spacing, 24, 8, 160, 'node_spacing'),
            layerSpacing: layoutValue(args.layer_spacing, 40, 8, 240, 'layer_spacing'),
        },
    };
}
/** Remove renderer-owned network imports, then reject active browser content. */
function prepareSvg(svg, maxBytes) {
    const selfContained = svg.replace(/^\s*@import\s+url\([^)]*\);\s*$/gmi, '');
    if (!/^<svg\b/i.test(selfContained.trimStart()) || !/<\/svg>\s*$/i.test(selfContained)) {
        throw new Error('renderer returned an invalid SVG document');
    }
    if (/<(?:script|foreignObject|iframe|object|embed)\b|javascript\s*:|\son[a-z]+\s*=|@import\b|\b(?:href|xlink:href)\s*=\s*["'](?:https?:|data:text\/html)/i.test(selfContained)) {
        throw new Error('renderer returned active SVG content');
    }
    const bytes = Buffer.byteLength(selfContained, 'utf8');
    if (bytes > maxBytes) {
        throw new Error(`rendered SVG exceeds the configured ${maxBytes}-byte limit`);
    }
    return { svg: selfContained, bytes };
}
/** Extract a useful nested write failure without echoing the generated SVG. */
function nestedWriteError(result) {
    return new Error(`flowchart write failed: ${result.error.message}`);
}
/** Install the model-facing rendering tool. */
export function apply(ctx, config) {
    const resolved = resolveConfig(config);
    ctx.tools.register(defineTool({
        name: 'render_flowchart',
        description: 'Render Mermaid flowchart source as a polished themed SVG file. Use `flowchart TD`/`LR` syntax; this tool does not render sequence, class, state, or ER diagrams.',
        parameters: {
            source: {
                type: 'string',
                required: true,
                description: 'Complete Mermaid flowchart source beginning with `flowchart TD`, `flowchart LR`, `graph TD`, or another supported direction.',
            },
            file_path: {
                type: 'string',
                required: true,
                description: 'Destination path ending in `.svg`. Writing follows the installed `write` tool permissions and overwrite policy.',
            },
            theme: {
                type: 'string',
                enum: [...THEME_NAMES],
                description: `Visual theme. Defaults to the deployment theme (${resolved.defaultTheme}).`,
            },
            transparent: {
                type: 'boolean',
                description: 'Use a transparent canvas instead of the theme background. Default false.',
            },
            padding: {
                type: 'integer',
                description: 'Canvas padding in pixels, 0-200. Default 40.',
            },
            node_spacing: {
                type: 'integer',
                description: 'Horizontal spacing between sibling nodes in pixels, 8-160. Default 24.',
            },
            layer_spacing: {
                type: 'integer',
                description: 'Vertical spacing between layers in pixels, 8-240. Default 40.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    path: { type: 'string', required: true },
                    theme: { type: 'string', required: true, enum: [...THEME_NAMES] },
                    bytes: { type: 'integer', required: true },
                },
            },
            render: (_args, value) => [{
                    type: 'text',
                    text: `Rendered ${value.theme} flowchart SVG (${value.bytes} bytes) at ${value.path}`,
                }],
        },
        async execute(args, exec) {
            const parsed = parseArgs(args, resolved);
            if (exec.signal.aborted)
                throw exec.signal.reason;
            const rendered = renderMermaidSVG(parsed.source, parsed.options);
            const { svg, bytes } = prepareSvg(rendered, resolved.maxSvgBytes);
            if (exec.signal.aborted)
                throw exec.signal.reason;
            const writeResult = await ctx.tools.execute({
                callId: CallId(`${exec.callId}:flowchart-write`),
                rootCallId: exec.rootCallId,
                name: 'write',
                arguments: { file_path: parsed.filePath, content: svg },
                ...exec.agent === undefined ? {} : { agent: exec.agent },
                parent: exec.token,
                signal: exec.signal,
            });
            if (writeResult.isError)
                throw nestedWriteError(writeResult);
            return { path: parsed.filePath, theme: parsed.theme, bytes };
        },
        presentCall(args) {
            return {
                card: 'generic',
                title: `Render flowchart ${args.file_path}`,
                kind: 'edit',
                rawInput: { theme: args.theme ?? resolved.defaultTheme },
                locations: [{ path: args.file_path }],
            };
        },
        presentResult(args, result) {
            return {
                card: 'generic',
                title: result.isError
                    ? `Flowchart failed: ${args.file_path}`
                    : `Rendered flowchart ${args.file_path}`,
            };
        },
    }));
}
