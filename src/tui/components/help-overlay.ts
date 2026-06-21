import { Box, Text } from '@vue-tui/runtime'
import { defineComponent, h } from 'vue'

const cmd = (name: string, args: string, desc: string) =>
  h(Text, {}, [
    h(Text, { color: 'cyan' }, `  ${name}`),
    h(Text, { dimColor: true }, args),
    h(Text, { color: 'gray' }, `  ${desc}`),
  ])

export const HelpOverlay = defineComponent({
  setup() {
    return () =>
      h(
        Box,
        {
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          flexGrow: 1,
        },
        [
          h(
            Box,
            {
              flexDirection: 'column',
              borderStyle: 'round',
              borderColor: 'cyan',
              paddingX: 2,
              paddingY: 1,
            },
            [
              h(Text, {}, [
                h(Text, { color: 'cyan' }, ' lonny'),
                h(Text, { dimColor: true }, ' TUI Help'),
              ]),
              h(Box, { height: 1 }),
              h(Text, { bold: true, color: 'gray' }, ' Commands:'),
              cmd('/mode', ' code|plan|ask|loop', 'Switch mode'),
              cmd('/model', ' <name>', 'Switch model'),
              cmd('/plans', '', 'Show plans'),
              cmd('/help', '', 'This help'),
              cmd('/exit', '', 'Exit'),
              h(Box, { height: 1 }),
              h(Text, { bold: true, color: 'gray' }, ' Keyboard:'),
              h(Text, { color: 'gray' }, '  Enter        Send message'),
              h(Text, { color: 'gray' }, '  \u2191/\u2193          Navigate history'),
              h(Text, { color: 'gray' }, '  Tab          Autocomplete'),
              h(Text, { color: 'gray' }, '  Esc          Close overlay'),
              h(Box, { height: 1 }),
              h(Text, { color: 'cyan' }, '\u2500'.repeat(26)),
            ],
          ),
        ],
      )
  },
})
