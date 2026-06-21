import { Box, Text, useInput } from '@vue-tui/runtime'
import { defineComponent, h, inject, ref } from 'vue'
import {
  kConfig,
  kPlansVersion,
  kSelectedPlanName,
  kShowPlanDetail,
  kShowPlans,
} from '../context.js'
import { colors } from './colors.js'
import { listPlans, plansToItems } from './plan-utils.js'

export const PlansList = defineComponent({
  setup() {
    const config = inject(kConfig)!
    const showPlans = inject(kShowPlans)!
    const showPlanDetail = inject(kShowPlanDetail)!
    const selectedPlanName = inject(kSelectedPlanName)!
    const plansVersion = inject(kPlansVersion)!
    const selectedIndex = ref(0)

    function getPlans() {
      return plansToItems(listPlans(config.cwd))
    }

    useInput((_input, key) => {
      if (key.escape) {
        showPlans.value = false
        showPlanDetail.value = false
        return
      }

      if (key.return && !showPlanDetail.value) {
        const plans = listPlans(config.cwd)
        if (plans.length > 0 && plans[selectedIndex.value]) {
          selectedPlanName.value = plans[selectedIndex.value].name
          showPlanDetail.value = true
        }
        return
      }

      if (key.upArrow) {
        selectedIndex.value = Math.max(0, selectedIndex.value - 1)
        return
      }

      if (key.downArrow) {
        const plans = listPlans(config.cwd)
        selectedIndex.value = Math.min(plans.length - 1, selectedIndex.value + 1)
        return
      }
    })

    return () => {
      const plans = listPlans(config.cwd)
      const items = plansToItems(plans)

      const children: any[] = [
        h(Box, { backgroundColor: colors.bgDark }, [
          h(Text, { color: colors.accent }, `\u25B6 Plans (${plans.length})  `),
          h(Text, { color: colors.dim }, 'Enter=view'),
        ]),
      ]

      if (plans.length === 0) {
        children.push(h(Text, { color: colors.dim }, '  (no plans yet)'))
      } else {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          const isSelected = i === selectedIndex.value
          const prefix = isSelected ? colors.accent : colors.dim
          children.push(
            h(
              Text,
              {
                color: isSelected ? '#ffffff' : colors.dim,
                backgroundColor: isSelected ? '#0080ff' : undefined,
              },
              ` ${prefix}\u25B6 ${item.label}`,
            ),
          )
        }
      }

      return h(
        Box,
        {
          position: 'absolute',
          right: 0,
          top: '50%',
          width: 45,
          backgroundColor: colors.bgDark,
          borderStyle: 'round',
          borderColor: colors.dim,
        },
        children,
      )
    }
  },
})
