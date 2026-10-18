import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORK_INBOX_ASK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['inbox', 'ask'],
    summary: 'Ask the human through the Orca Work Inbox and block until answered',
    usage:
      'orca inbox ask (--question <text> | --resume <id>) [--options <csv>] [--no-free-text] [--request-id <id>] [--timeout-ms <n>] [--from <handle>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'question',
      'resume',
      'options',
      'no-free-text',
      'request-id',
      'timeout-ms',
      'from'
    ],
    identityFlagRoles: { from: 'caller' },
    notes: [
      'Works from any agent in an Orca terminal; no orchestration Dispatch is needed.',
      'Prints the chosen option label and/or free-text answer, then exits 0.',
      'On timeout or a lost connection the question stays open; wait again with --resume <id>, never ask again.'
    ]
  }
]
