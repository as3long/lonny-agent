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
    const group = normalizeLabel(def.group, 'Unclassified')
    const categoryNode = getOrCreate([category], 0)

    if (group && group !== 'Unclassified') {
      const groupNode = getOrCreate([category, group], 1)
      groupNode.children?.push(createToolNode(def, 2))
    } else {
      categoryNode.children?.push(createToolNode(def, 1))
    }
  }

  return root
}

export function formatToolTreeForPrompt(definitions: ToolDefinition[]): string {
  const lines: string[] = []

  function render(node: ToolTreeNode, level: number): void {
    const indent = '  '.repeat(level)
    if (node.type === 'group') {
      lines.push(`${indent}- ${node.name}`)
    } else {
      lines.push(`${indent}- \`${node.name}\`: ${node.description || ''}`)
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
