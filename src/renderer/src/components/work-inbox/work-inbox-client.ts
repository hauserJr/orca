import type {
  WorkInboxAnswerParams,
  WorkInboxListParams,
  WorkInboxListResult,
  WorkInboxMutationResult
} from '../../../../shared/work-inbox'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'

export function workInboxTargetKey(target: RuntimeClientTarget): string {
  return target.kind === 'environment' ? `environment:${target.environmentId}` : 'local'
}

export function listWorkInbox(
  target: RuntimeClientTarget,
  params: WorkInboxListParams,
  signal?: AbortSignal
): Promise<WorkInboxListResult> {
  return callRuntimeRpc<WorkInboxListResult>(target, 'workInbox.list', params, { signal })
}

export function answerWorkInboxItem(
  target: RuntimeClientTarget,
  params: WorkInboxAnswerParams
): Promise<WorkInboxMutationResult> {
  return callRuntimeRpc<WorkInboxMutationResult>(target, 'workInbox.answer', params)
}
