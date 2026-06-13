import type { ToolDefinition, ToolTreeNode } from './types.js'

function normalizeLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed && trimmed !== 'Unclassified' ? trimmed : fallback
}

function createToolNode(def: ToolDefinition, depth: number): ToolTreeNode {
  return {
    type: 'tool',
    name: def.name,
    description: def.description,
    toolName: def.name,
    depth,
  }
}

export function buildToolTree(definitions: ToolDefinition[]): ToolTreeNode[] {
  const root: ToolTreeNode[] = []
  const groups = new Map<string, ToolTreeNode>()

  function getOrCreate(parts: string[], depth: number): ToolTreeNode {
    const key = parts.join('/')
    let node = groups.get(key)
    if (!node) {
      node = {
        type: 'group',
        name: parts[parts.length - 1] || 'Other',
        children: [],
        depth,
      }
      groups.set(key, node)

      if (parts.length === 1) {
        root.push(node)
      } else {
        const parent = groups.get(parts.slice(0, -1).join('/'))
        parent?.children?.push(node)
      }
    }
    return node
  }

  for (const def of definitions) {
    const category = normalizeLabel(def.category, 'Other')
    const rawGroup = normalizeLabel(def.group, 'Unclassified')

    // Build path: category first, then split group by '/' for multi-level nesting
    const parts = [category]
    if (rawGroup && rawGroup !== 'Unclassified') {
      parts.push(
        ...rawGroup
          .split('/')
          .map(p => p.trim())
          .filter(Boolean),
      )
    }

    // Create all intermediate group nodes (parents before children)
    for (let i = 1; i <= parts.length; i++) {
      const node = getOrCreate(parts.slice(0, i), i - 1)
      if (i === parts.length) {
        node.children?.push(createToolNode(def, i))
      }
    }
  }

  return root
}

/**
 * Format the tool tree for inclusion in the system prompt.
 *
 * @param definitions - All tool definitions (for building the full tree)
 * @param coreNames - Optional set of core tool names. When provided, tools NOT
 *   in this set are annotated with "(via tool)" to indicate they require the
 *   `tool()` gateway.
 */
export function formatToolTreeForPrompt(
  definitions: ToolDefinition[],
  coreNames?: Set<string>,
): string {
  const lines: string[] = []

  function render(node: ToolTreeNode, level: number): void {
    const indent = '  '.repeat(level)
    if (node.type === 'group') {
      lines.push(`${indent}- ${node.name}`)
    } else {
      const suffix = coreNames && !coreNames.has(node.name) ? ' (via tool gateway)' : ''
      lines.push(`${indent}- \`${node.name}\`: ${node.description || ''}${suffix}`)
    }
    for (const child of node.children || []) {
      render(child, level + 1)
    }
  }

  for (const node of buildToolTree(definitions)) {
    render(node, 0)
  }

  return lines.join('\n')
}
