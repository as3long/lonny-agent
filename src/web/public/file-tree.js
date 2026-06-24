/* ── File Tree Component ── */

import { fileRevealBtn, fileTree, state } from './state.js'
import { sendWsMsg } from './ws.js'
import { onPlanClick } from './sidebar.js'

// ── Icons ──
const ICON_FOLDER = '📁'
const ICON_FOLDER_OPEN = '📂'
const ICON_FILE = '📄'
const ICON_MARKDOWN = '📝'
const ICON_LONNY = '⚙'
const ICON_PLAN = '📋'

// ── Escape HTML ──
function esc(s) {
  const div = document.createElement('div')
  div.textContent = s
  return div.innerHTML
}

// ── Get icon by file name ──
function getFileIcon(name) {
  if (name === '.lonny') return ICON_LONNY
  if (name.endsWith('.md')) return ICON_PLAN
  if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.mjs')) return '🟦'
  if (name.endsWith('.json')) return '📋'
  if (name.endsWith('.css')) return '🎨'
  if (name.endsWith('.html')) return '🌐'
  return ICON_FILE
}

// ── Build tree node HTML ──
function buildTreeNode(item, depth) {
  const isDir = item.type === 'directory'
  const isExpanded = state.fileTreeExpanded.has(item.path)
  const isActive = item.path === state.fileTreeActive
  const isDotLonny = item.name === '.lonny' || item.path.startsWith('.lonny/')
  const icon = isDir
    ? (isExpanded ? ICON_FOLDER_OPEN : ICON_FOLDER)
    : getFileIcon(item.name)

  const li = document.createElement('li')
  li.className = `tree-item${isDir ? ' tree-dir' : ' tree-file'}${isActive ? ' active' : ''}${isDotLonny ? ' dot-lonny' : ''}`
  li.dataset.path = item.path
  li.style.paddingLeft = `${8 + depth * 16}px`

  const label = document.createElement('span')
  label.className = 'tree-label'
  label.innerHTML = `<span class="tree-icon">${icon}</span><span class="tree-name">${esc(item.name)}</span>`

  if (isDir) {
    // Toggle expand on click
    label.addEventListener('click', (e) => {
      e.stopPropagation()
      if (isExpanded) {
        state.fileTreeExpanded.delete(item.path)
        collapseNode(li)
      } else {
        state.fileTreeExpanded.add(item.path)
        expandNode(li, item)
      }
    })
    li.appendChild(label)

    // Children container
    const ul = document.createElement('ul')
    ul.className = 'tree-children' + (isExpanded ? '' : ' collapsed')
    li.appendChild(ul)

    if (isExpanded && item.children) {
      for (const child of item.children) {
        ul.appendChild(buildTreeNode(child, depth + 1))
      }
    }

    // If not expanded but has children, show placeholder for lazy load
    if (!isExpanded && item.children === undefined) {
      // mark for lazy loading
      li.dataset.lazy = 'true'
    }
  } else {
    // File: click to load
    label.addEventListener('click', (e) => {
      e.stopPropagation()
      selectFile(item)
    })
    li.appendChild(label)
  }

  return li
}

// ── Expand a directory node (lazy load children) ──
function expandNode(li, item) {
  const ul = li.querySelector('.tree-children')
  if (!ul) return

  // If already has children, just show them
  if (item.children && item.children.length > 0) {
    ul.classList.remove('collapsed')
    // Rebuild children to ensure active state is correct
    ul.innerHTML = ''
    for (const child of item.children) {
      ul.appendChild(buildTreeNode(child, getDepth(li) + 1))
    }
    return
  }

  // Need to fetch children
  if (item.children === undefined || item.children.length === 0) {
    sendWsMsg({ type: 'get_file_tree', path: item.path })
    // Show a loading state
    ul.innerHTML = '<li class="tree-loading">⏳ loading...</li>'
    ul.classList.remove('collapsed')
  }
}

// ── Collapse a directory node ──
function collapseNode(li) {
  const ul = li.querySelector('.tree-children')
  if (ul) ul.classList.add('collapsed')
}

// ── Calculate depth from padding ──
function getDepth(li) {
  const pad = parseInt(li.style.paddingLeft) || 8
  return Math.max(0, Math.floor((pad - 8) / 16))
}

// ── Select a file ──
function selectFile(item) {
  // Update active
  state.fileTreeActive = item.path
  updateActiveStyles()

  // If it's a .lonny/*.md file, also select the plan
  if (item.path.startsWith('.lonny/') && item.path.endsWith('.md')) {
    const planName = item.path.replace('.lonny/', '').replace(/\.md$/, '')
    onPlanClick(planName)
  }

  // Load the file content
  sendWsMsg({ type: 'load_file', path: item.path })
}

// ── Update active styles after selection ──
function updateActiveStyles() {
  fileTree.querySelectorAll('.tree-item.active').forEach(el => el.classList.remove('active'))
  const active = fileTree.querySelector(`[data-path="${esc(state.fileTreeActive)}"]`)
  if (active) active.classList.add('active')
}

// ── Reveal a file in the tree (expand parents, select file) ──
export function revealFile(filePath) {
  // Ensure we have tree data
  if (!state.fileTreeData) {
    sendWsMsg({ type: 'get_file_tree', path: '' })
    return
  }

  const parts = filePath.replace(/\\/g, '/').split('/')
  let currentPath = ''
  const toExpand = []

  for (let i = 0; i < parts.length - 1; i++) {
    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
    toExpand.push(currentPath)
  }

  // Expand all parent directories
  for (const p of toExpand) {
    state.fileTreeExpanded.add(p)
  }

  // Set active
  state.fileTreeActive = filePath

  // Re-render and scroll to file
  renderFileTree(state.fileTreeData)
  requestAnimationFrame(() => {
    const active = fileTree.querySelector(`[data-path="${esc(filePath)}"]`)
    if (active) {
      active.scrollIntoView({ block: 'nearest' })
      active.classList.add('active')
    }
  })
}

// ── Render file tree ──
export function renderFileTree(treeData) {
  state.fileTreeData = treeData
  fileTree.innerHTML = ''

  if (!treeData) {
    fileTree.innerHTML = '<div class="panel-placeholder">Loading files...</div>'
    return
  }

  if (treeData.children && treeData.children.length > 0) {
    const ul = document.createElement('ul')
    ul.className = 'tree-root'
    for (const child of treeData.children) {
      ul.appendChild(buildTreeNode(child, 0))
    }
    fileTree.appendChild(ul)
  } else if (Array.isArray(treeData)) {
    // Flat array mode
    const ul = document.createElement('ul')
    ul.className = 'tree-root'
    for (const child of treeData) {
      ul.appendChild(buildTreeNode(child, 0))
    }
    fileTree.appendChild(ul)
  } else {
    fileTree.innerHTML = '<div class="panel-placeholder">Empty directory</div>'
  }
}

// ── Update existing tree with children for a path (lazy load callback) ──
export function updateTreeChildren(parentPath, children) {
  // Update state data
  const update = (items) => {
    for (const item of items) {
      if (item.path === parentPath) {
        item.children = children
        return true
      }
      if (item.children) {
        if (update(item.children)) return true
      }
    }
    return false
  }

  if (state.fileTreeData) {
    if (state.fileTreeData.children) {
      update(state.fileTreeData.children)
    } else if (Array.isArray(state.fileTreeData)) {
      update(state.fileTreeData)
    }
  }

  // Update DOM
  const parentLi = fileTree.querySelector(`[data-path="${esc(parentPath)}"]`)
  if (!parentLi) return

  const ul = parentLi.querySelector('.tree-children')
  if (!ul) return

  ul.innerHTML = ''
  if (children && children.length > 0) {
    for (const child of children) {
      ul.appendChild(buildTreeNode(child, getDepth(parentLi) + 1))
    }
  } else {
    ul.innerHTML = '<li class="tree-empty">(empty)</li>'
  }
}

// ── Initialize ──
export function initFileTree() {
  // Request initial file tree
  sendWsMsg({ type: 'get_file_tree', path: '' })

  // Reveal button
  fileRevealBtn.addEventListener('click', () => {
    // Reveal current plan file
    if (state.currentPlanName) {
      revealFile(`.lonny/${state.currentPlanName}.md`)
    }
  })
}

// ── Expose API for sidebar.js ──
window.fileTreeApi = { revealFile }