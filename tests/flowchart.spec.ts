import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as Flowchart from '../src/index.ts'
import type { Config } from '../src/index.ts'

const contexts: Context[] = []
const directories: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function harness(config: Config = {}, withWrite = true): Promise<{
  ctx: Context
  directory: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-flowchart-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (withWrite) {
    await ctx.plugin(LocalFileSystem, { cwd: directory })
    await ctx.plugin(ToolFs, {})
  }
  await ctx.plugin(Flowchart, config)
  return { ctx, directory }
}

async function render(
  ctx: Context,
  args: Record<string, unknown>,
) {
  return await ctx.tools.execute({
    callId: CallId(crypto.randomUUID()),
    name: 'render_flowchart',
    arguments: args,
    signal: new AbortController().signal,
  })
}

describe('render_flowchart', () => {
  it('renders a themed SVG and writes it through the registered write tool', async () => {
    const { ctx, directory } = await harness()
    const output = join(directory, 'checkout.svg')

    const result = await render(ctx, {
      source: [
        'flowchart LR',
        '  cart([Cart]) --> payment{Payment valid?}',
        '  payment -->|Yes| success([Order placed])',
        '  payment -->|No| retry[Retry payment]',
        '  retry --> payment',
      ].join('\n'),
      file_path: output,
      theme: 'catppuccin-mocha',
      transparent: false,
      padding: 56,
      node_spacing: 36,
      layer_spacing: 64,
    })

    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({ path: output, theme: 'catppuccin-mocha' })
    expect(result.content).toEqual([{
      type: 'text',
      text: expect.stringMatching(/^Rendered catppuccin-mocha flowchart SVG \(\d+ bytes\) at /),
    }])

    const svg = await readFile(output, 'utf8')
    expect(svg).toMatch(/^<svg\b/)
    expect(svg).toContain('</svg>')
    expect(svg).toContain('Cart')
    expect(svg).toContain('Payment valid?')
    expect(svg).toContain('--bg:#1e1e2e')
    expect(svg).not.toContain('@import')
    expect(svg).not.toContain('fonts.googleapis.com')
    expect(Buffer.byteLength(svg, 'utf8')).toBe((result.value as { bytes: number }).bytes)
  })

  it('uses the configured default theme and keeps replayable presentation locations', async () => {
    const { ctx, directory } = await harness({ defaultTheme: 'github-light' })
    const output = join(directory, 'simple.svg')
    const definition = ctx.tools.get('render_flowchart')

    const result = await render(ctx, {
      source: 'graph TD\n  A[Start] --> B[Done]',
      file_path: output,
    })

    expect(result.isError).toBe(false)
    if (!result.isError) expect(result.value).toMatchObject({ theme: 'github-light' })
    expect(definition?.presentCall?.({
      source: 'graph TD\n  A --> B',
      file_path: output,
    })).toEqual({
      card: 'generic',
      title: `Render flowchart ${output}`,
      kind: 'edit',
      rawInput: { theme: 'github-light' },
      locations: [{ path: output }],
    })
  })

  it('rejects unsupported Mermaid diagram types before writing', async () => {
    const { ctx, directory } = await harness()
    const output = join(directory, 'sequence.svg')

    const result = await render(ctx, {
      source: 'sequenceDiagram\n  Alice->>Bob: Hello',
      file_path: output,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('source must start with a Mermaid flowchart header') },
    })
    await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('enforces the complete rendered SVG byte limit before writing', async () => {
    const { ctx, directory } = await harness({ maxSvgBytes: 100 })
    const output = join(directory, 'too-large.svg')

    const result = await render(ctx, {
      source: 'flowchart TD\n  A[Start] --> B[Done]',
      file_path: output,
    })

    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('rendered SVG exceeds the configured 100-byte limit') },
    })
    await expect(readFile(output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('fails through the nested tool pipeline when no write tool is registered', async () => {
    const { ctx } = await harness({}, false)

    const result = await render(ctx, {
      source: 'flowchart TD\n  A --> B',
      file_path: 'missing-write.svg',
    })

    expect(result).toMatchObject({
      isError: true,
      error: { message: expect.stringContaining('flowchart write failed: unknown tool "write"') },
    })
  })

  it('removes the tool when the plugin fiber is disposed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-flowchart-dispose-'))
    directories.push(directory)
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const mounted = await ctx.plugin(Flowchart, {})
    expect(ctx.tools.get('render_flowchart')).toBeDefined()

    await mounted.dispose()

    expect(ctx.tools.get('render_flowchart')).toBeUndefined()
  })

  it('rejects invalid deployment bounds at plugin load', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    await expect(ctx.plugin(Flowchart, { maxSvgBytes: 0 }))
      .rejects.toThrow('maxSvgBytes expected number >= 1')
  })
})
