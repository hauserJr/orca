import React from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type {
  RuntimeTerminalAgentStatus,
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../../../shared/runtime-types'
import {
  WorkInboxGuidanceParams,
  workInboxAgentProcessKey
} from '../../../../shared/work-inbox-guidance'
import type { TerminalProcessInspection } from '../../../../shared/terminal-process-inspection'
import type { RemoteForegroundEvidence } from '../../../../shared/foreground-process-evidence'
import { sendWorkInboxAgentGuidance, workInboxTargetKey } from './work-inbox-client'
import { createBrowserUuid } from '@/lib/browser-uuid'

type GuidanceAttempt = { params: WorkInboxGuidanceParams; confirmed: boolean }
export function useWorkInboxAgentConnection(target: RuntimeClientTarget | null) {
  const [terminals, setTerminals] = React.useState<RuntimeTerminalSummary[] | null>(null)
  const [selected, setSelected] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [message, setMessage] = React.useState<string | null>(null)
  const [processEvidence, setProcessEvidence] = React.useState<RemoteForegroundEvidence>()
  const attempted = React.useRef(new Map<string, GuidanceAttempt>())
  const key = target ? workInboxTargetKey(target) : null
  const generation = React.useRef(0)
  const selectionGeneration = React.useRef(0)
  const [priorKey, setPriorKey] = React.useState(key)
  if (priorKey !== key) {
    setPriorKey(key)
    generation.current += 1
    selectionGeneration.current += 1
    setTerminals(null)
    setSelected('')
    setProcessEvidence(undefined)
    setBusy(false)
    setMessage(null)
  }
  const unavailable = (): string =>
    translate(
      'auto.components.work-inbox.connectUnavailable',
      'Could not confirm an idle agent. Finish its current prompt in the terminal, then try again.'
    )
  const unconfirmed = (): string =>
    translate(
      'auto.components.work-inbox.connectUnconfirmed',
      'Could not confirm delivery. Check the agent before sending routing guidance again.'
    )
  const storageKey = (handle: string): string => `orca-work-inbox-guidance:${key}:${handle}`
  function remember(handle: string, attempt: GuidanceAttempt): void {
    sessionStorage.setItem(storageKey(handle), JSON.stringify(attempt))
    attempted.current.set(`${key}:${handle}`, attempt)
  }
  async function selectAgent(handle: string): Promise<void> {
    setSelected(handle)
    setProcessEvidence(undefined)
    if (!handle || target?.kind !== 'local') {
      return
    }
    const selection = ++selectionGeneration.current
    try {
      const raw = sessionStorage.getItem(storageKey(handle))
      const saved: unknown = raw ? JSON.parse(raw) : null
      if (
        saved &&
        typeof saved === 'object' &&
        'params' in saved &&
        'confirmed' in saved &&
        typeof saved.confirmed === 'boolean'
      ) {
        const params = WorkInboxGuidanceParams.safeParse(saved.params)
        if (params.success && params.data.terminal === handle) {
          attempted.current.set(`${key}:${handle}`, {
            params: params.data,
            confirmed: saved.confirmed
          })
        }
      }
      const result = await callRuntimeRpc<{ process: TerminalProcessInspection }>(
        target,
        'terminal.inspectProcess',
        { terminal: handle, scanChildProcesses: true }
      )
      if (
        selectionGeneration.current === selection &&
        workInboxAgentProcessKey(result.process.foregroundProcessEvidence)
      ) {
        setProcessEvidence(result.process.foregroundProcessEvidence)
      }
    } catch {
      if (selectionGeneration.current === selection) {
        setMessage(unavailable())
      }
    }
  }
  async function listAgents(): Promise<void> {
    if (!target || busy) {
      return
    }
    if (target.kind !== 'local') {
      setMessage(
        translate(
          'auto.components.work-inbox.connectLocalOnly',
          'Open Work Inbox on the computer running the agent to connect an existing conversation.'
        )
      )
      return
    }
    const operation = generation.current
    setBusy(true)
    try {
      const result = await callRuntimeRpc<RuntimeTerminalListResult>(target, 'terminal.list', {
        limit: 64
      })
      if (generation.current !== operation) {
        return
      }
      const available = result.terminals.filter(
        (t) => t.connected && t.writable && Boolean(t.agentIdentity)
      )
      setTerminals(available)
      await selectAgent(available[0]?.handle ?? '')
      if (generation.current === operation) {
        setMessage(available.length ? null : unavailable())
      }
    } catch {
      if (generation.current === operation) {
        setMessage(unavailable())
      }
    } finally {
      if (generation.current === operation) {
        setBusy(false)
      }
    }
  }
  async function connect(): Promise<void> {
    if (
      target?.kind !== 'local' ||
      !selected ||
      busy ||
      attempted.current.get(`${key}:${selected}`)?.confirmed
    ) {
      return
    }
    const operation = generation.current
    setBusy(true)
    try {
      const attemptKey = `${key}:${selected}`
      const previous = attempted.current.get(attemptKey)
      if (!previous) {
        const result = await callRuntimeRpc<{ agentStatus: RuntimeTerminalAgentStatus }>(
          target,
          'terminal.agentStatus',
          { terminal: selected }
        )
        if (generation.current !== operation) {
          return
        }
        if (
          !result.agentStatus.isRunningAgent ||
          result.agentStatus.status !== 'idle' ||
          !processEvidence
        ) {
          setMessage(unavailable())
          return
        }
      }
      const attempt = previous ?? {
        params: WorkInboxGuidanceParams.parse({
          terminal: selected,
          requestId: createBrowserUuid(),
          expectedProcess: processEvidence
        }),
        confirmed: false
      }
      remember(selected, attempt)
      const response = await sendWorkInboxAgentGuidance(attempt.params)
      if (generation.current !== operation) {
        return
      }
      if (!response.send.accepted) {
        attempted.current.delete(attemptKey)
        sessionStorage.removeItem(storageKey(selected))
        setMessage(unavailable())
        return
      }
      if (!response.send.prompt?.stages.includes('turn_started')) {
        setMessage(unconfirmed())
        return
      }
      remember(selected, { ...attempt, confirmed: true })
      setMessage(
        translate(
          'auto.components.work-inbox.connectSent',
          'Routing guidance sent. Continue with this same agent; its conversation and account are kept.'
        )
      )
    } catch {
      if (generation.current === operation) {
        setMessage(unconfirmed())
      }
    } finally {
      if (generation.current === operation) {
        setBusy(false)
      }
    }
  }
  return {
    target,
    terminals,
    selected,
    setSelected: (handle: string) => {
      void selectAgent(handle)
    },
    busy,
    message,
    canSend: Boolean(selected) && !attempted.current.get(`${key}:${selected}`)?.confirmed,
    checking: Boolean(attempted.current.get(`${key}:${selected}`)),
    listAgents,
    connect
  }
}
export function WorkInboxAgentConnection({
  connection
}: {
  connection: ReturnType<typeof useWorkInboxAgentConnection>
}): React.JSX.Element {
  const {
    target,
    terminals,
    selected,
    setSelected,
    busy,
    message,
    canSend,
    checking,
    listAgents,
    connect
  } = connection
  return (
    <div className="space-y-2 border-b border-border px-4 py-3">
      <Button
        variant="outline"
        size="sm"
        disabled={!target || busy}
        onClick={() => void listAgents()}
      >
        {translate('auto.components.work-inbox.connectExisting', 'Connect an existing agent')}
      </Button>
      {terminals?.length ? (
        <div className="flex items-center gap-2">
          <Select value={selected} onValueChange={setSelected} disabled={busy}>
            <SelectTrigger
              aria-label={translate('auto.components.work-inbox.connectSelect', 'Existing agent')}
              className="min-w-0 flex-1"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {terminals.map((terminal) => (
                <SelectItem key={terminal.handle} value={terminal.handle}>
                  {terminal.title ?? 'Agent'} — {terminal.worktreePath}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={busy || !canSend} onClick={() => void connect()}>
            {checking && canSend
              ? translate('auto.components.work-inbox.connectCheck', 'Check delivery')
              : translate('auto.components.work-inbox.connectSend', 'Send guidance')}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  )
}
