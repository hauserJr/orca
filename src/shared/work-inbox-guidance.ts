import { z } from 'zod'
import {
  isRemoteForegroundEvidence,
  type RemoteForegroundEvidence
} from './foreground-process-evidence'
import { recognizeAgentProcess } from './agent-process-recognition'
import { WORK_INBOX_EXISTING_AGENT_INSTRUCTIONS } from './work-inbox-routing-instructions'

export const WorkInboxGuidanceParams = z
  .object({
    terminal: z.string().min(1).max(256),
    requestId: z.string().uuid(),
    expectedProcess: z
      .custom<RemoteForegroundEvidence>(isRemoteForegroundEvidence)
      .refine((e) => workInboxAgentProcessKey(e) !== null)
  })
  .strict()
export type WorkInboxGuidanceParams = z.infer<typeof WorkInboxGuidanceParams>

export function workInboxGuidanceTerminalPrompt(
  terminal: string,
  expectedProcess: RemoteForegroundEvidence
) {
  return {
    terminal,
    expectedWorkInboxProcess: expectedProcess,
    text: WORK_INBOX_EXISTING_AGENT_INSTRUCTIONS,
    enter: true,
    agentPrompt: true,
    requireAgentStatus: 'idle',
    requireWriteSettlement: true,
    waitSubmitMs: 5000,
    client: { id: 'orca-work-inbox', type: 'desktop' }
  } as const
}

export function workInboxAgentProcessKey(
  evidence: RemoteForegroundEvidence | undefined
): string | null {
  if (
    !evidence ||
    evidence.verdict !== 'live' ||
    !evidence.fence.process ||
    !evidence.processName ||
    !recognizeAgentProcess(evidence.processName)?.agent
  ) {
    return null
  }
  const fence = evidence.fence
  return JSON.stringify([
    evidence.authorityGeneration,
    evidence.ptyId,
    evidence.ptyIncarnationId,
    fence.platform,
    fence.platform === 'windows'
      ? [
          fence.rootProcessId,
          fence.rootCreationTime,
          fence.sessionId,
          fence.process?.pid,
          fence.process?.creationTime
        ]
      : [
          fence.shellPid,
          fence.shellStartTime,
          fence.tty,
          fence.foregroundPgid,
          fence.process?.pid,
          fence.process?.startTime
        ]
  ])
}

export const workInboxCodexProcessKey = workInboxAgentProcessKey
