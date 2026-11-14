'use client'

import { formatNumber, type MessageDescriptor, usePascalI18n, useScene } from '@pascal-app/core'
import {
  ArrowUp,
  Check,
  FileText,
  LayoutGrid,
  type LucideIcon,
  PanelRightClose,
  Settings2,
  ShieldCheck,
  Sofa,
  Square,
  Undo2,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { digestScene, roomsOf } from '@/lib/agent/digest'
import {
  type AgentAction,
  type AgentChange,
  type AgentModelSettingsView,
  type AgentRoom,
  type AgentState,
  type AgentTask,
  EMPLOYEE_IDS,
  type EmployeeId,
  TASK_STATUSES,
  type TaskStatus,
} from '@/lib/agent/types'
import { cn } from '@/lib/utils'

const EMPLOYEES: Record<EmployeeId, { icon: LucideIcon; tint: string; label: MessageDescriptor }> =
  {
    plan: {
      icon: LayoutGrid,
      tint: 'bg-sky-100 text-sky-600',
      label: /* i18n */ { id: 'app.agentPanel.employee.plan', message: 'Plan employee' },
    },
    interior: {
      icon: Sofa,
      tint: 'bg-amber-100 text-amber-600',
      label: /* i18n */ { id: 'app.agentPanel.employee.interior', message: 'Interior employee' },
    },
    check: {
      icon: ShieldCheck,
      tint: 'bg-emerald-100 text-emerald-600',
      label: /* i18n */ { id: 'app.agentPanel.employee.check', message: 'Checking employee' },
    },
    drawing: {
      icon: FileText,
      tint: 'bg-violet-100 text-violet-600',
      label: /* i18n */ { id: 'app.agentPanel.employee.drawing', message: 'Drawing employee' },
    },
  }

const COLUMN_LABELS: Record<TaskStatus, MessageDescriptor> = {
  todo: /* i18n */ { id: 'app.agentPanel.column.todo', message: 'To do' },
  doing: /* i18n */ { id: 'app.agentPanel.column.doing', message: 'In progress' },
  review: /* i18n */ { id: 'app.agentPanel.column.review', message: 'To accept' },
  done: /* i18n */ { id: 'app.agentPanel.column.done', message: 'Done' },
}

const CHANGE_LABELS: Record<AgentChange['status'], MessageDescriptor> = {
  running: /* i18n */ { id: 'app.agentPanel.change.running', message: 'Working…' },
  applied: /* i18n */ { id: 'app.agentPanel.change.applied', message: 'Applied' },
  refused: /* i18n */ { id: 'app.agentPanel.change.refused', message: 'Refused' },
  reverted: /* i18n */ { id: 'app.agentPanel.change.reverted', message: 'Reverted' },
}

const ERROR_LABELS: Record<string, MessageDescriptor> = {
  model_not_configured: /* i18n */ {
    id: 'app.agentPanel.error.modelNotConfigured',
    message: 'Set up a model first: the Boss needs one to work.',
  },
  busy: /* i18n */ {
    id: 'app.agentPanel.error.busy',
    message: 'The team is busy on another project. Try again when it is done.',
  },
  model_failed: /* i18n */ {
    id: 'app.agentPanel.error.modelFailed',
    message: 'The model did not answer.',
  },
  stopped: /* i18n */ { id: 'app.agentPanel.error.stopped', message: 'Stopped.' },
  failed: /* i18n */ { id: 'app.agentPanel.error.failed', message: 'Something went wrong.' },
}

const CARD = 'flex min-h-0 flex-col rounded-2xl border border-black/5 bg-white shadow-sm'
const CARD_TITLE = 'shrink-0 border-black/5 border-b px-3 py-2 text-center font-medium text-[13px]'

/** The Boss's mark: an arrow in a soft colour ring. */
function BossMark({ size }: { size: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-[conic-gradient(from_210deg,#f9a8d4,#c4b5fd,#93c5fd,#fde68a,#f9a8d4)]',
        size === 'lg' ? 'h-16 w-16 p-[5px]' : 'h-6 w-6 p-[2px]',
      )}
    >
      <span
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full bg-white font-bold text-neutral-900',
          size === 'lg' ? 'text-lg' : 'text-[9px]',
        )}
      >
        {'=>'}
      </span>
    </span>
  )
}

function EmployeeBadge({ employee, withName }: { employee: EmployeeId; withName?: boolean }) {
  const i18n = usePascalI18n()
  const { icon: Icon, tint, label } = EMPLOYEES[employee]
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={i18n._(label)}>
      <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full', tint)}>
        <Icon className="h-2.5 w-2.5" />
      </span>
      {withName && <span className="truncate">{i18n._(label)}</span>}
    </span>
  )
}

/** The rooms of the scene the editor holds, re-read a moment after it changes. */
function useSceneRooms(): AgentRoom[] {
  const [rooms, setRooms] = useState<AgentRoom[]>([])
  useEffect(() => {
    const read = () =>
      setRooms(roomsOf(digestScene(useScene.getState().nodes as Parameters<typeof digestScene>[0])))
    read()
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = useScene.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(read, 400)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])
  return rooms
}

function useAgentState(sceneId: string): AgentState | null {
  const [state, setState] = useState<AgentState | null>(null)
  useEffect(() => {
    const source = new EventSource(`/api/scenes/${sceneId}/agent`)
    source.addEventListener('state', (event) => {
      try {
        setState(JSON.parse((event as MessageEvent<string>).data) as AgentState)
      } catch {
        // A truncated event: the next one carries the whole state again.
      }
    })
    return () => source.close()
  }, [sceneId])
  return state
}

function ModelSettingsForm({ onSaved }: { onSaved: () => void }) {
  const i18n = usePascalI18n()
  const [view, setView] = useState<AgentModelSettingsView | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/agent/settings')
      .then((response) => response.json() as Promise<AgentModelSettingsView>)
      .then((loaded) => {
        if (cancelled) return
        setView(loaded)
        setBaseUrl(loaded.baseUrl)
        setModel(loaded.model)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const response = await fetch('/api/agent/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, model, ...(apiKey ? { apiKey } : {}) }),
    }).catch(() => null)
    if (response?.ok) onSaved()
    else setFailed(true)
  }

  const field =
    'w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-neutral-400'
  return (
    <form className="flex flex-col gap-2 p-3 text-[12px]" onSubmit={save}>
      <p className="text-neutral-500">
        {i18n._({
          id: 'app.agentPanel.settings.intro',
          message:
            'Any OpenAI-compatible chat endpoint works. The key is kept in this app’s private data on this computer.',
        })}
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-neutral-600">
          {i18n._({ id: 'app.agentPanel.settings.baseUrl', message: 'Base URL' })}
        </span>
        <input
          className={field}
          name="baseUrl"
          onChange={(event) => setBaseUrl(event.target.value)}
          placeholder="https://api.example.com/v1"
          required
          type="url"
          value={baseUrl}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-neutral-600">
          {i18n._({ id: 'app.agentPanel.settings.model', message: 'Model' })}
        </span>
        <input
          className={field}
          name="model"
          onChange={(event) => setModel(event.target.value)}
          required
          value={model}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-neutral-600">
          {i18n._({ id: 'app.agentPanel.settings.apiKey', message: 'API key' })}
        </span>
        <input
          autoComplete="off"
          className={field}
          name="apiKey"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={
            view?.hasApiKey
              ? i18n._({
                  id: 'app.agentPanel.settings.apiKeySaved',
                  message: 'Saved. Type a new one to replace it.',
                })
              : undefined
          }
          required={!view?.hasApiKey}
          type="password"
          value={apiKey}
        />
      </label>
      {failed && (
        <p className="text-red-600">
          {i18n._({
            id: 'app.agentPanel.settings.failed',
            message: 'These settings could not be saved.',
          })}
        </p>
      )}
      <button
        className="mt-1 self-end rounded-full bg-neutral-900 px-3.5 py-1.5 font-medium text-white hover:bg-neutral-700"
        type="submit"
      >
        {i18n._({ id: 'app.agentPanel.settings.save', message: 'Save' })}
      </button>
    </form>
  )
}

function TaskCard({ task }: { task: AgentTask }) {
  const i18n = usePascalI18n()
  const note =
    task.note ||
    (task.status === 'doing'
      ? i18n._({ id: 'app.agentPanel.task.thinking', message: 'Thinking…' })
      : '')
  return (
    <li
      className={cn(
        'rounded-lg border bg-white p-1.5 text-[11px] leading-snug',
        task.status === 'doing' ? 'border-sky-400 shadow-sm' : 'border-black/10',
      )}
      data-task-status={task.status}
    >
      <p className="break-words font-medium text-neutral-900">{task.title}</p>
      <p className="mt-1 text-neutral-500">
        <EmployeeBadge employee={task.employee} withName />
      </p>
      {note && <p className="mt-1 line-clamp-3 break-words text-neutral-400">{note}</p>}
    </li>
  )
}

export function AgentPanel({ sceneId, onClose }: { sceneId: string; onClose: () => void }) {
  const i18n = usePascalI18n()
  const state = useAgentState(sceneId)
  const rooms = useSceneRooms()
  const [draft, setDraft] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const transcript = useRef<HTMLDivElement>(null)

  const act = useCallback(
    (action: AgentAction) =>
      fetch(`/api/scenes/${sceneId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      }).catch(() => null),
    [sceneId],
  )

  const messageCount = state?.messages.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: follows the newest message
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight })
  }, [messageCount])

  const working = state?.status === 'working'
  const send = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || working) return
    setDraft('')
    void act({ action: 'message', text })
  }

  const tasks = state?.board?.tasks ?? []
  const errorLabel = state?.error ? (ERROR_LABELS[state.error] ?? ERROR_LABELS.failed) : null
  const bossName = i18n._({ id: 'app.agentPanel.boss', message: 'Boss' })

  return (
    <aside
      className="flex h-full w-[380px] shrink-0 flex-col gap-2 bg-[#f4f1ec] p-2 font-sans text-neutral-900 [color-scheme:light]"
      data-agent-panel={state?.status ?? 'loading'}
    >
      <header className="flex shrink-0 items-center gap-2 px-1 text-[12px] text-neutral-600">
        <span>
          {working
            ? i18n._({ id: 'app.agentPanel.working', message: 'AI at work' })
            : i18n._({ id: 'app.agentPanel.team', message: 'AI team' })}
        </span>
        <span className="flex items-center gap-1">
          {EMPLOYEE_IDS.map((employee) => (
            <EmployeeBadge employee={employee} key={employee} />
          ))}
        </span>
        <span className="flex-1" />
        <button
          aria-label={i18n._({ id: 'app.agentPanel.modelSettings', message: 'Model settings' })}
          aria-pressed={settingsOpen}
          className="rounded-md p-1 hover:bg-black/5"
          onClick={() => setSettingsOpen((open) => !open)}
          type="button"
        >
          <Settings2 className="h-4 w-4" />
        </button>
        <button
          aria-label={i18n._({ id: 'app.agentPanel.hide', message: 'Hide the AI team' })}
          className="rounded-md p-1 hover:bg-black/5"
          onClick={onClose}
          type="button"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </header>

      <section className={cn(CARD, 'flex-[5]')}>
        <h2 className={CARD_TITLE}>{bossName}</h2>
        {settingsOpen ? (
          <ModelSettingsForm onSaved={() => setSettingsOpen(false)} />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" ref={transcript}>
              {messageCount === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <BossMark size="lg" />
                  <span className="font-medium text-[13px]">{bossName}</span>
                </div>
              ) : (
                <ul className="flex flex-col gap-2 text-[12px] leading-relaxed">
                  {state?.messages.map((message) =>
                    message.author === 'user' ? (
                      <li
                        className="max-w-[85%] self-end whitespace-pre-wrap break-words rounded-2xl bg-neutral-900 px-3 py-1.5 text-white"
                        key={message.id}
                      >
                        {message.text}
                      </li>
                    ) : (
                      <li className="flex max-w-[92%] items-start gap-1.5" key={message.id}>
                        <span className="mt-1">
                          {message.author === 'boss' ? (
                            <BossMark size="sm" />
                          ) : (
                            <EmployeeBadge employee={message.author} />
                          )}
                        </span>
                        <span className="whitespace-pre-wrap break-words rounded-2xl bg-[#f3efee] px-3 py-1.5">
                          {message.text}
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
            {errorLabel && (
              <div className="mx-3 mb-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                <p>{i18n._(errorLabel)}</p>
                {state?.errorDetail && (
                  <p className="mt-0.5 break-words text-red-500">{state.errorDetail}</p>
                )}
                {state?.error === 'model_not_configured' && (
                  <button
                    className="mt-1 font-medium underline"
                    onClick={() => setSettingsOpen(true)}
                    type="button"
                  >
                    {i18n._({ id: 'app.agentPanel.modelSettings', message: 'Model settings' })}
                  </button>
                )}
              </div>
            )}
            <form
              className="m-2 mt-0 flex shrink-0 items-center gap-2 rounded-full border border-black/10 bg-white py-1 pr-1 pl-3.5 shadow-sm"
              onSubmit={send}
            >
              <input
                aria-label={i18n._({ id: 'app.agentPanel.say', message: 'Tell the Boss…' })}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400"
                name="message"
                onChange={(event) => setDraft(event.target.value)}
                placeholder={i18n._({ id: 'app.agentPanel.say', message: 'Tell the Boss…' })}
                value={draft}
              />
              {working ? (
                <button
                  aria-label={i18n._({ id: 'app.agentPanel.stop', message: 'Stop' })}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700"
                  onClick={() => void act({ action: 'stop' })}
                  type="button"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  aria-label={i18n._({ id: 'app.agentPanel.send', message: 'Send' })}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-40"
                  disabled={!draft.trim()}
                  type="submit"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </form>
          </>
        )}
      </section>

      <section className={cn(CARD, 'flex-[4]')}>
        <h2 className={cn(CARD_TITLE, 'truncate')}>
          {i18n._({ id: 'app.agentPanel.board', message: 'Board' })}
          {state?.board ? ` · ${state.board.title}` : ''}
        </h2>
        <div className="grid shrink-0 grid-cols-4 gap-1.5 px-2 pt-2">
          {TASK_STATUSES.map((status) => (
            <h3
              className="rounded-md bg-[#f4f1ec] px-1.5 py-1 text-[11px] text-neutral-600"
              key={status}
            >
              {i18n._(COLUMN_LABELS[status])}
            </h3>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-4 items-start gap-1.5 overflow-y-auto p-2">
          {TASK_STATUSES.map((status) => (
            <ul className="flex min-w-0 flex-col gap-1.5" data-board-column={status} key={status}>
              {tasks
                .filter((task) => task.status === status)
                .map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
            </ul>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 p-2 pt-0">
          <button
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-medium text-[12px] text-white hover:bg-emerald-600 disabled:opacity-40"
            disabled={state?.status !== 'review'}
            onClick={() => void act({ action: 'accept' })}
            type="button"
          >
            <Check className="h-3.5 w-3.5" />
            {i18n._({ id: 'app.agentPanel.accept', message: 'Accept' })}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 text-[12px] text-neutral-700 hover:bg-black/5 disabled:opacity-40"
            disabled={!state?.canRevert || working}
            onClick={() => void act({ action: 'revert' })}
            type="button"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {i18n._({ id: 'app.agentPanel.revert', message: 'Revert' })}
          </button>
        </div>
      </section>

      <section className={cn(CARD, 'flex-[3]')}>
        {/* Tracks with a zero minimum: a bare `fr` track is sized from its content's narrowest
            wrapping, and acdert may then paint the text with those line breaks. */}
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] divide-x divide-black/5">
          <div className="flex min-h-0 flex-col">
            <h2 className={CARD_TITLE}>
              {i18n._({ id: 'app.agentPanel.changes', message: 'Change list' })}
            </h2>
            <ol className="min-h-0 flex-1 overflow-y-auto p-2 text-[11px] leading-snug">
              {state?.changes.map((change) => (
                <li className="py-1" data-change-status={change.status} key={change.id}>
                  <div className="flex items-center justify-between gap-2 text-neutral-500">
                    <EmployeeBadge employee={change.employee} withName />
                    <span
                      className={cn(
                        'shrink-0',
                        change.status === 'applied' && 'text-emerald-600',
                        change.status === 'refused' && 'text-red-500',
                        (change.status === 'running' || change.status === 'reverted') &&
                          'text-neutral-400',
                      )}
                    >
                      {i18n._(CHANGE_LABELS[change.status])}
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-neutral-900">{change.text}</p>
                </li>
              ))}
            </ol>
          </div>
          <div className="flex min-h-0 flex-col">
            <h2 className={CARD_TITLE}>
              {i18n._({ id: 'app.agentPanel.areas', message: 'Areas' })}
            </h2>
            <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-[11px] leading-snug">
              {rooms.map((room, index) => (
                <li className="flex justify-between gap-2 py-0.5" key={index}>
                  <span className="truncate">{room.name || '—'}</span>
                  <span className="shrink-0 font-mono text-neutral-600">
                    {formatNumber(room.areaSqMeters, { min: 1, max: 1 })} m²
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </aside>
  )
}

/** Brings the panel back after it was hidden. */
export function AgentPanelToggle({ onOpen }: { onOpen: () => void }) {
  const i18n = usePascalI18n()
  return (
    <button
      aria-label={i18n._({ id: 'app.agentPanel.show', message: 'Show the AI team' })}
      className="absolute top-1/2 right-2 z-40 -translate-y-1/2 rounded-full shadow-lg"
      onClick={onOpen}
      type="button"
    >
      <BossMark size="lg" />
    </button>
  )
}
