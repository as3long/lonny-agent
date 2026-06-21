import * as fs from 'node:fs'
import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h, inject, ref, watch } from 'vue'
import { kConfig, kPlansVersion } from '../context.js'
import { colors } from './colors.js'
import { listPlans, type PlanEntry } from './plan-utils.js'

interface TodoItem {
  text: string
  done: boolean
}

export const TodoPanel = defineComponent({
  setup() {
    const config = inject(kConfig)!
    const plansVersion = inject(kPlansVersion)!
    const todos = ref<TodoItem[]>([])
    const planName = ref('')

    function loadTodos() {
      const plans = listPlans(config.cwd)
      if (plans.length === 0) {
        todos.value = []
        planName.value = ''
        return
      }
      const plan = plans[0]
      planName.value = plan.name
      const items: TodoItem[] = []
      try {
        const content = fs.readFileSync(plan.fullPath, 'utf-8')
        for (const line of content.split('\n')) {
          const m = line.trim().match(/^- \[([ x])\]\s+(.+)/)
          if (m) {
            items.push({ text: m[2], done: m[1] === 'x' })
          }
        }
      } catch {}
      todos.value = items
    }

    watch(plansVersion, loadTodos)
    loadTodos()

    return () => {
      const children: any[] = [
        h(Box, { backgroundColor: colors.bgDark }, [
          h(Text, { color: colors.accent }, '\u25B6 TODO'),
        ]),
        h(Text, { color: colors.separator }, '\u2500'.repeat(36)),
      ]

      if (!planName.value) {
        children.push(h(Text, { color: colors.dim }, '  (no plan)'))
        return h(Box, { flexDirection: 'column' }, children)
      }

      if (todos.value.length === 0) {
        children.push(h(Text, { color: colors.dim }, '  (no todos)'))
        return h(Box, { flexDirection: 'column' }, children)
      }

      for (const todo of todos.value) {
        const icon = todo.done ? '\u2705' : '\u2B1C'
        const color = todo.done ? colors.doneTodo : colors.todo
        children.push(h(Text, { color }, ` ${icon} ${todo.text}`))
      }

      return h(Box, { flexDirection: 'column' }, children)
    }
  },
})
