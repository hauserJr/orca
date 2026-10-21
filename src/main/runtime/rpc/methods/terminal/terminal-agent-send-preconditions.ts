import type { z } from 'zod'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import type { TerminalSend } from '../../../../../shared/rpc-contract/terminal-unary-params'
import { assertTerminalAgentSendable } from '../../terminal-agent-send-guard'
import { workInboxAgentProcessKey } from '../../../../../shared/work-inbox-guidance'
import { PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS } from '../../../../../shared/process-table-snapshot'
import {
  assertTerminalSendExactPtyBinding,
  isTerminalInputLockedForClient
} from './terminal-input-delivery'

export async function assertTerminalAgentSendPreconditions(
  runtime: OrcaRuntimeService,
  params: z.infer<typeof TerminalSend>,
  ptyId?: string
): Promise<void> {
  await assertTerminalAgentSendable({
    runtime,
    handle: params.terminal,
    requireIdle: params.requireAgentStatus === 'idle',
    assertWritable: () => {
      assertTerminalSendExactPtyBinding(runtime, params.terminal, ptyId)
      if (ptyId && isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
        throw new Error('terminal_guard_not_writable')
      }
    }
  })
  if (params.expectedWorkInboxProcess) {
    const expectedKey = workInboxAgentProcessKey(params.expectedWorkInboxProcess)
    const observed = (
      await runtime.inspectTerminalProcess(params.terminal, {
        expectedIncarnationId: params.expectedWorkInboxProcess.ptyIncarnationId,
        scanChildProcesses: true
      })
    ).foregroundProcessEvidence
    if (
      !expectedKey ||
      !observed ||
      observed.capturedAgeMs > PROCESS_TABLE_SNAPSHOT_MAX_STALENESS_MS ||
      workInboxAgentProcessKey(observed) !== expectedKey
    ) {
      throw new Error('terminal_guard_not_writable')
    }
  }
  assertTerminalSendExactPtyBinding(runtime, params.terminal, ptyId)
  if (ptyId && isTerminalInputLockedForClient(runtime, ptyId, params.client)) {
    throw new Error('terminal_guard_not_writable')
  }
}
