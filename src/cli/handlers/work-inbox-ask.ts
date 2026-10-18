import { randomUUID } from 'node:crypto'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag } from '../flags'
import { printResult } from '../format'
import { renderCommand } from '../orchestration-mutation-recovery'
import { RuntimeClientError } from '../runtime-client'
import { resolveOrchestrationCliExecutable } from '../runtime/orchestration-recovery-command'
import { injectedSessionAddress } from '../../shared/agent-session-caller-env'
import {
  clampOrchestrationAskTimeoutMs,
  resolveOrchestrationAskClientTimeoutMs
} from '../../shared/orchestration-ask-timeout'
import type { WorkInboxAnswer, WorkInboxAskResult } from '../../shared/work-inbox'
import { getOptionalPositiveIntegerValueFlag } from './orchestration/numeric-flags'
import { flushOrchestrationStdout } from './orchestration/runtime-compatibility'
import { resolveOrchestrationTerminalHandle } from './orchestration/terminal-identity'

function formatAnswer(answer: WorkInboxAnswer): string {
  return [answer.optionLabel, answer.text].filter(Boolean).join('\n')
}

export const WORK_INBOX_ASK_HANDLERS: Record<string, CommandHandler> = {
  'inbox ask': async ({ flags, client, cwd, json }) => {
    const parsedTimeoutMs = getOptionalPositiveIntegerValueFlag(flags, 'timeout-ms')
    const timeoutMs = clampOrchestrationAskTimeoutMs(parsedTimeoutMs)
    const question = getOptionalStringFlag(flags, 'question')
    const resume = getOptionalStringFlag(flags, 'resume')
    if ((question ? 1 : 0) + (resume ? 1 : 0) !== 1) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Choose exactly one of --question or --resume.'
      )
    }
    // Why: a chat session has no terminal handle; its session address still classifies the asker.
    const from =
      (await resolveOrchestrationTerminalHandle(flags, cwd, client, 'from')) ??
      injectedSessionAddress()
    const requestId = resume
      ? undefined
      : (getOptionalStringFlag(flags, 'request-id') ?? randomUUID())
    const response = await client
      .call<WorkInboxAskResult>(
        'workInbox.ask',
        {
          from,
          question,
          resume,
          options: getOptionalStringFlag(flags, 'options'),
          allowFreeText: flags.get('no-free-text') === true ? false : undefined,
          requestId,
          timeoutMs: parsedTimeoutMs === undefined ? undefined : timeoutMs
        },
        // Why: outlive the host's own deadline so the transport never aborts a live wait.
        { timeoutMs: resolveOrchestrationAskClientTimeoutMs(parsedTimeoutMs) }
      )
      .catch((error: unknown) => {
        if (requestId) {
          console.error(`Preserve the original question and retry with --request-id ${requestId}`)
        }
        throw error
      })
    const result = response.result
    if (json) {
      printResult(response, true, () => '')
    } else if (result.answer) {
      console.log(formatAnswer(result.answer))
    }
    if (result.answer && result.status === 'answered') {
      // Why: acknowledge only after the answer reached stdout, so `delivered` means the agent has it.
      await flushOrchestrationStdout()
      try {
        await client.call('workInbox.ack', { id: result.id, from })
      } catch (error) {
        console.error(
          `Answer printed, but acknowledging ${result.id} failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    if (result.cancelled) {
      if (!json) {
        console.error(`Question ${result.id} was dismissed in the Work Inbox without an answer.`)
      }
      process.exitCode = 1
    } else if (result.timedOut) {
      if (!json) {
        const resumeCommand = renderCommand([
          resolveOrchestrationCliExecutable(),
          'inbox',
          'ask',
          '--resume',
          result.id,
          '--timeout-ms',
          String(result.timeoutMs)
        ])
        console.error(
          `No answer after ${result.timeoutMs}ms; question ${result.id} is still open. Keep waiting; do not ask again:\n${resumeCommand}`
        )
      }
      process.exitCode = 1
    }
  }
}
