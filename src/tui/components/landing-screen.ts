import { Box, Text, useInput } from '@vue-tui/runtime'
import { defineComponent, h, inject } from 'vue'
import { kConfig } from '../context.js'
import { APP_VERSION, colors } from './colors.js'
import { renderPixelLogo } from './pixel-logo.js'

export const LandingScreen = defineComponent({
  emits: ['submit'],
  setup(_props, { emit }) {
    const config = inject(kConfig)!

    useInput((_input, key) => {
      if (key.return) {
        emit('submit')
      }
    })

    return () => {
      const logoLines = renderPixelLogo()
      const logoText = logoLines.join('\n')
      const divider = '\u2500'.repeat(36)
      const cmds = '/mode  \u00B7  /model  \u00B7  /plans  \u00B7  /help'

      return h(
        Box,
        {
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexGrow: 1,
        },
        [
          h(Text, { color: colors.dim }, logoText),
          h(Box, { height: 1 }),
          h(Text, { color: colors.separator }, divider),
          h(Box, { height: 1 }),
          h(Text, { color: colors.dim }, 'Type a message and press '),
          h(Text, { color: colors.accent }, 'Enter'),
          h(Text, { color: colors.dim }, ' to start'),
          h(Box, { height: 1 }),
          h(Text, { color: colors.dim }, 'Commands: '),
          h(Text, { color: colors.inputPrompt }, cmds),
          h(Box, { height: 1 }),
          h(
            Text,
            { color: colors.dim },
            `${config.provider}/${config.model} \u2502 v${APP_VERSION}`,
          ),
        ],
      )
    }
  },
})
