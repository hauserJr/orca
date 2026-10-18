import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkInboxItem } from '../../../../shared/work-inbox'
import { WORK_INBOX_LIST_MAX } from '../../../../shared/work-inbox'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import { hasRuntimeRpcErrorCode } from '@/runtime/runtime-rpc-result'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { answerWorkInboxItem, listWorkInbox, workInboxTargetKey } from './work-inbox-client'
import {
  EMPTY_WORK_INBOX_DRAFT,
  buildWorkInboxAnswer,
  canSubmitWorkInboxDraft,
  editWorkInboxDraft,
  mergeWorkInboxItems,
  workInboxDraftKey,
  type WorkInboxDraft
} from './work-inbox-answer-draft'

export type WorkInboxView = 'open' | 'history'
export type WorkInboxLoadError = 'unsupported' | 'failed'
export type WorkInboxFilterOption = { id: string; label: string }

export const WORK_INBOX_PAGE_SIZE = 50
export const WORK_INBOX_REFRESH_MS = 15_000

type ListSnapshot = { queryKey: string; items: WorkInboxItem[] }
/** Per-host facts that outlive one view or filter: filter labels and the unfiltered open count. */
type KnownLabels = {
  targetKey: string
  projects: Map<string, string>
  agents: Map<string, string>
  openCount: number | null
}

function rememberLabels(
  known: KnownLabels,
  items: readonly WorkInboxItem[],
  openCount: number
): KnownLabels {
  const projects = new Map(known.projects)
  const agents = new Map(known.agents)
  for (const item of items) {
    if (item.projectId) {
      projects.set(item.projectId, item.projectLabel ?? item.projectId)
    }
    agents.set(item.agentId, item.agentLabel)
  }
  return { targetKey: known.targetKey, projects, agents, openCount }
}

function sortedOptions(labels: Map<string, string>): WorkInboxFilterOption[] {
  return [...labels]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function useWorkInbox({
  open,
  target
}: {
  open: boolean
  /** Null until settings load, so a default local fetch can't race the real host. Must be
   *  referentially stable per host: a new object each render refetches each render. */
  target: RuntimeClientTarget | null
}) {
  const targetKey = target ? workInboxTargetKey(target) : null
  const [view, setView] = useState<WorkInboxView>('open')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [agentId, setAgentId] = useState<string | null>(null)
  const [limit, setLimit] = useState(WORK_INBOX_PAGE_SIZE)
  const [list, setList] = useState<ListSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<WorkInboxLoadError | null>(null)
  const [known, setKnown] = useState<KnownLabels>({
    targetKey: '',
    projects: new Map(),
    agents: new Map(),
    openCount: null
  })
  const [drafts, setDrafts] = useState<Record<string, WorkInboxDraft>>({})
  const requestSeq = useRef(0)
  const inFlightAnswers = useRef(new Set<string>())
  const loadingRef = useRef(false)

  // Why: filters and pages name one host's rows; a host switch must never show them against another.
  const [filtersTargetKey, setFiltersTargetKey] = useState(targetKey)
  if (filtersTargetKey !== targetKey) {
    setFiltersTargetKey(targetKey)
    setProjectId(null)
    setAgentId(null)
    setLimit(WORK_INBOX_PAGE_SIZE)
    setLoadError(null)
  }

  const queryKey = `${targetKey ?? ''}|${view}|${projectId ?? ''}|${agentId ?? ''}`

  const load = useCallback(async (): Promise<void> => {
    if (!target || !targetKey) {
      return
    }
    const seq = ++requestSeq.current
    const requestQueryKey = queryKey
    loadingRef.current = true
    setLoading(true)
    try {
      const result = await listWorkInbox(target, {
        view,
        ...(projectId ? { projectId } : {}),
        ...(agentId ? { agentId } : {}),
        limit
      })
      if (seq !== requestSeq.current) {
        return
      }
      setList((previous) => ({
        queryKey: requestQueryKey,
        items:
          previous?.queryKey === requestQueryKey
            ? mergeWorkInboxItems(previous.items, result.items)
            : result.items
      }))
      setKnown((previous) =>
        rememberLabels(
          previous.targetKey === targetKey
            ? previous
            : { targetKey, projects: new Map(), agents: new Map(), openCount: null },
          result.items,
          result.openCount
        )
      )
      setLoadError(null)
    } catch (error) {
      if (seq !== requestSeq.current) {
        return
      }
      console.error('Failed to load Work Inbox:', error)
      setLoadError(hasRuntimeRpcErrorCode(error, 'method_not_found') ? 'unsupported' : 'failed')
    } finally {
      if (seq === requestSeq.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [target, targetKey, queryKey, view, projectId, agentId, limit])

  useEffect(() => {
    if (!open || !target) {
      return
    }
    void load()
    const timer = window.setInterval(() => {
      // Why: a background tick must not supersede a user-triggered load still in flight.
      if (!loadingRef.current) {
        void load()
      }
    }, WORK_INBOX_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [open, target, load])

  const visibleList = list?.queryKey === queryKey ? list : null
  const items = visibleList?.items ?? []
  const knownForTarget = known.targetKey === targetKey ? known : null

  const projectOptions = useMemo(
    () => (knownForTarget ? sortedOptions(knownForTarget.projects) : []),
    [knownForTarget]
  )
  const agentOptions = useMemo(
    () => (knownForTarget ? sortedOptions(knownForTarget.agents) : []),
    [knownForTarget]
  )

  const getDraft = useCallback(
    (itemId: string): WorkInboxDraft =>
      (targetKey ? drafts[workInboxDraftKey(targetKey, itemId)] : undefined) ??
      EMPTY_WORK_INBOX_DRAFT,
    [drafts, targetKey]
  )

  const updateDraft = useCallback(
    (itemId: string, patch: Partial<Pick<WorkInboxDraft, 'optionId' | 'text'>>): void => {
      if (!targetKey) {
        return
      }
      const key = workInboxDraftKey(targetKey, itemId)
      setDrafts((previous) => ({
        ...previous,
        [key]: editWorkInboxDraft(previous[key] ?? EMPTY_WORK_INBOX_DRAFT, patch)
      }))
    },
    [targetKey]
  )

  const replaceItem = useCallback((requestQueryKey: string, item: WorkInboxItem): void => {
    setList((previous) =>
      previous?.queryKey === requestQueryKey
        ? {
            ...previous,
            items: previous.items.map((existing) =>
              existing.id === item.id && existing.revision <= item.revision ? item : existing
            )
          }
        : previous
    )
  }, [])

  const submitAnswer = useCallback(
    async (item: WorkInboxItem): Promise<void> => {
      if (!target || !targetKey) {
        return
      }
      const key = workInboxDraftKey(targetKey, item.id)
      const draft = drafts[key] ?? EMPTY_WORK_INBOX_DRAFT
      // Why: the ref closes the gap between a click and React committing `submitting`.
      if (inFlightAnswers.current.has(key) || !canSubmitWorkInboxDraft(item, draft)) {
        return
      }
      inFlightAnswers.current.add(key)
      const params = buildWorkInboxAnswer(item, draft, createBrowserUuid)
      const setDraft = (next: (current: WorkInboxDraft) => WorkInboxDraft | null): void =>
        setDrafts((previous) => {
          const updated = next(previous[key] ?? EMPTY_WORK_INBOX_DRAFT)
          const rest = { ...previous }
          delete rest[key]
          return updated ? { ...rest, [key]: updated } : rest
        })
      setDraft((current) => ({ ...current, pending: params, submitting: true, failure: null }))
      const requestQueryKey = queryKey
      try {
        const result = await answerWorkInboxItem(target, params)
        if (result.status === 'ok') {
          setDraft(() => null)
          replaceItem(requestQueryKey, result.item)
        } else if (result.status === 'conflict') {
          // Keep the text so the human can reread the current state and answer again if still open.
          setDraft((current) => ({
            ...current,
            pending: null,
            submitting: false,
            failure: 'conflict'
          }))
          replaceItem(requestQueryKey, result.item)
        } else {
          setDraft((current) => ({
            ...current,
            pending: null,
            submitting: false,
            failure: 'not-found'
          }))
        }
      } catch (error) {
        console.error('Failed to answer Work Inbox question:', error)
        // Why: the answer may have landed; keep `pending` so Retry is deduped by the host.
        setDraft((current) => ({ ...current, submitting: false, failure: 'unreachable' }))
      } finally {
        inFlightAnswers.current.delete(key)
      }
    },
    [target, targetKey, drafts, queryKey, replaceItem]
  )

  const showMore = useCallback((): void => {
    setLimit((current) => Math.min(current + WORK_INBOX_PAGE_SIZE, WORK_INBOX_LIST_MAX))
  }, [])

  return {
    view,
    setView,
    projectId,
    setProjectId,
    agentId,
    setAgentId,
    items,
    openCount: knownForTarget?.openCount ?? null,
    hasLoaded: visibleList !== null,
    loading,
    loadError,
    canShowMore: items.length >= limit && limit < WORK_INBOX_LIST_MAX,
    showMore,
    reload: load,
    projectOptions,
    agentOptions,
    getDraft,
    updateDraft,
    submitAnswer
  }
}

export type WorkInboxController = ReturnType<typeof useWorkInbox>
