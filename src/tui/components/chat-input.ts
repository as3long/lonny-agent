import { Box, Text, useInput } from '@vue-tui/runtime'
import { computed, defineComponent, h, inject, onUnmounted, ref, watch } from 'vue'
import { kIsRunning } from '../context.js'
import { CommandSuggestions } from './command-suggestions.js'

const slashCommands = [
  { name: 'mode', description: 'Switch mode', argumentHint: 'code|plan|ask|loop' },
  { name: 'model', description: 'Switch model', argumentHint: '<name>' },
  { name: 'plans', description: 'Show plans overlay' },
  { name: 'prompts', description: 'List prompt templates' },
  { name: 'skills', description: 'List active skills' },
  { name: 'new', description: 'Start a new session' },
  { name: 'init', description: 'Create .kilo/skills/ & prompts/' },
  { name: 'help', description: 'Show help' },
  { name: 'exit', description: 'Exit' },
  { name: 'filter', description: 'Filter plans', argumentHint: '<query>' },
]

export const ChatInput = defineComponent({
  emits: ['submit'],
  setup(_props, { emit }) {
    const inputText = ref('')
    const history = ref<string[]>([])
    const historyIndex = ref(-1)
    const showCursor = ref(true)
    const selectedSuggestionIndex = ref(0)
    const isRunning = inject(kIsRunning)!

    let cursorInterval: ReturnType<typeof setInterval>
    cursorInterval = setInterval(() => {
      showCursor.value = !showCursor.value
    }, 500)
    onUnmounted(() => clearInterval(cursorInterval))

    const suggestions = computed(() => {
      if (!inputText.value.startsWith('/')) return []
      const query = inputText.value.slice(1).toLowerCase()
      if (!query) return slashCommands
      return slashCommands.filter(cmd => cmd.name.toLowerCase().startsWith(query))
    })

    const showSuggestions = computed(
      () => suggestions.value.length > 0 && inputText.value.startsWith('/'),
    )

    watch(suggestions, () => {
      if (selectedSuggestionIndex.value >= suggestions.value.length) {
        selectedSuggestionIndex.value = 0
      }
    })

    function selectSuggestion(index: number): void {
      const cmd = suggestions.value[index]
      if (cmd) {
        inputText.value = `/${cmd.name} `
        selectedSuggestionIndex.value = 0
      }
    }

    useInput((input, key) => {
      if (isRunning.value) return

      if (showSuggestions.value) {
        if (key.upArrow) {
          selectedSuggestionIndex.value = Math.max(0, selectedSuggestionIndex.value - 1)
          return
        }
        if (key.downArrow) {
          selectedSuggestionIndex.value = Math.min(
            suggestions.value.length - 1,
            selectedSuggestionIndex.value + 1,
          )
          return
        }
        if (key.return || key.tab) {
          selectSuggestion(selectedSuggestionIndex.value)
          return
        }
        if (key.escape) {
          selectedSuggestionIndex.value = 0
          inputText.value = inputText.value.replace(/\/.*$/, '')
          return
        }
      }

      if (key.return) {
        const trimmed = inputText.value.trim()
        if (trimmed) {
          history.value.push(trimmed)
          historyIndex.value = -1
          emit('submit', trimmed)
          inputText.value = ''
        }
        return
      }

      if (key.upArrow) {
        if (history.value.length > 0) {
          const newIdx =
            historyIndex.value === -1
              ? history.value.length - 1
              : Math.max(0, historyIndex.value - 1)
          historyIndex.value = newIdx
          inputText.value = history.value[newIdx]
        }
        return
      }

      if (key.downArrow) {
        if (historyIndex.value >= 0) {
          const newIdx = historyIndex.value + 1
          if (newIdx >= history.value.length) {
            historyIndex.value = -1
            inputText.value = ''
          } else {
            historyIndex.value = newIdx
            inputText.value = history.value[newIdx]
          }
        }
        return
      }

      if (key.backspace || key.delete) {
        inputText.value = inputText.value.slice(0, -1)
        return
      }

      if (input && !key.ctrl && !key.meta) {
        inputText.value += input
      }
    })

    return () => {
      if (isRunning.value) {
        return h(Box, {}, [h(Text, {}, '...')])
      }
      const children = [
        h(Box, {}, [
          h(Text, { wrap: 'truncate-start' }, `> ${inputText.value}${showCursor.value ? '|' : ''}`),
        ]),
      ]
      if (showSuggestions.value) {
        children.push(h(Box, { height: 1 }))
        children.push(
          h(Box, { backgroundColor: '#1a1a2e' }, [
            h(CommandSuggestions, {
              suggestions: suggestions.value,
              selectedIndex: selectedSuggestionIndex.value,
            }),
          ]),
        )
      }
      return h(Box, { flexDirection: 'column' }, children)
    }
  },
})
