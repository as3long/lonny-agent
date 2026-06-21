import * as fs from 'node:fs'
import { Box, Text, useInput } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kConfig, kSelectedPlanName, kShowPlanDetail, kShowPlans } from '../context.js'
import { colors } from './colors.js'
import { loadTodos } from './plan-utils.js'

export const PlanDetail = defineComponent({
  setup() {
    const showPlanDetail = inject(kShowPlanDetail)!
    const showPlans = inject(kShowPlans)!
    const selectedPlanName = inject(kSelectedPlanName)!
    const config = inject(kConfig)!

    useInput((_input, key) => {
      if (key.escape) {
        showPlanDetail.value = false
      }
    })

    return () => {
      const todos = loadTodos(config.cwd)

      return h(
        Box,
        {
          position: 'absolute',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
        },
        [
          h(
            Box,
            {
              width: 50,
              backgroundColor: colors.bgDark,
              borderStyle: 'round',
              borderColor: colors.dim,
              padding: 1,
            },
            [
              h(Box, {}, [
                h(Text, { color: colors.accent }, '\u25B6 '),
                h(Text, { color: colors.warn }, selectedPlanName.value),
                h(Text, { color: colors.dim }, '  Esc=back'),
              ]),
              h(Box, { height: 1 }),
              h(Text, { color: colors.dim }, todos),
            ],
          ),
        ],
      )
    }
  },
})
