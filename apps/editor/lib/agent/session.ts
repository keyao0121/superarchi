import type {
  AgentAuthor,
  AgentBoard,
  AgentChange,
  AgentState,
  AgentTask,
  EmployeeId,
} from './types'

type Listener = (state: AgentState) => void

/**
 * One project's conversation with the assistant, kept in the backend process
 * for as long as it runs: the page shows it and may reload, the run goes on.
 */
export class AgentSession {
  #state: AgentState
  #listeners = new Set<Listener>()
  #nextId = 1
  /** Aborts the run in flight, if any. */
  abort: AbortController | null = null
  /** The scene as it stood before the last run, for Revert. */
  snapshot: unknown = null

  constructor(sceneId: string) {
    this.#state = {
      sceneId,
      status: 'idle',
      error: null,
      errorDetail: null,
      messages: [],
      board: null,
      changes: [],
      canRevert: false,
    }
  }

  get state(): AgentState {
    return this.#state
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#state)
  }

  set(patch: Partial<Omit<AgentState, 'sceneId'>>): void {
    this.#state = { ...this.#state, ...patch }
    this.#emit()
  }

  say(author: AgentAuthor, text: string): void {
    const trimmed = text.trim()
    if (!trimmed) return
    this.set({
      messages: [...this.#state.messages, { id: this.#nextId++, author, text: trimmed }],
    })
  }

  openBoard(title: string, tasks: Pick<AgentTask, 'title' | 'employee' | 'instructions'>[]): void {
    const board: AgentBoard = { title, tasks: [] }
    this.set({ board, changes: [] })
    for (const task of tasks) this.addTask(task)
  }

  addTask(task: Pick<AgentTask, 'title' | 'employee' | 'instructions'>): AgentTask {
    const added: AgentTask = { ...task, id: this.#nextId++, status: 'todo', note: '' }
    const board = this.#state.board
    if (board) this.set({ board: { ...board, tasks: [...board.tasks, added] } })
    return added
  }

  updateTask(id: number, patch: Partial<Pick<AgentTask, 'status' | 'note'>>): void {
    const board = this.#state.board
    if (!board) return
    this.set({
      board: {
        ...board,
        tasks: board.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
      },
    })
  }

  addChange(employee: EmployeeId, text: string): number {
    const change: AgentChange = { id: this.#nextId++, employee, text, status: 'running' }
    this.set({ changes: [...this.#state.changes, change] })
    return change.id
  }

  updateChange(id: number, status: AgentChange['status']): void {
    this.set({
      changes: this.#state.changes.map((change) =>
        change.id === id ? { ...change, status } : change,
      ),
    })
  }
}

type SessionRegistry = Map<string, AgentSession>

/**
 * On `globalThis`: Next bundles each route on its own, and the event stream
 * and the action route must reach the same sessions.
 */
function registry(): SessionRegistry {
  const scope = globalThis as { __pascalAgentSessions?: SessionRegistry }
  scope.__pascalAgentSessions ??= new Map()
  return scope.__pascalAgentSessions
}

export function agentSession(sceneId: string): AgentSession {
  const sessions = registry()
  let session = sessions.get(sceneId)
  if (!session) {
    session = new AgentSession(sceneId)
    sessions.set(sceneId, session)
  }
  return session
}
