/**
 * The in-app assistant's state, as the backend keeps it per project and the
 * panel renders it. No server-only imports: the page reads these types too.
 */

/** Who does a task. The boss only plans; `check` and `drawing` never write. */
export const EMPLOYEE_IDS = ['plan', 'interior', 'check', 'drawing'] as const
export type EmployeeId = (typeof EMPLOYEE_IDS)[number]

export type AgentAuthor = 'user' | 'boss' | EmployeeId

export interface AgentMessage {
  id: number
  author: AgentAuthor
  text: string
}

/** The board's four columns, in order. */
export const TASK_STATUSES = ['todo', 'doing', 'review', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface AgentTask {
  id: number
  title: string
  employee: EmployeeId
  instructions: string
  status: TaskStatus
  /** What the employee is doing right now (`doing`) or reported at the end. */
  note: string
}

export interface AgentBoard {
  title: string
  tasks: AgentTask[]
}

/** One scene edit an employee made, in the order it was applied. */
export interface AgentChange {
  id: number
  employee: EmployeeId
  text: string
  status: 'running' | 'applied' | 'refused' | 'reverted'
}

/** A row of the panel's area schedule, read from the editor's own scene. */
export interface AgentRoom {
  name: string
  level: string
  areaSqMeters: number
}

/**
 * `review`: the run finished and waits for the person to accept or revert it.
 * `error` names a code the panel words (`model_not_configured`, `busy`,
 * `model_failed`, `stopped`, `failed`) with `errorDetail` as the raw reason.
 */
export interface AgentState {
  sceneId: string
  status: 'idle' | 'working' | 'review' | 'error'
  error: string | null
  errorDetail: string | null
  messages: AgentMessage[]
  board: AgentBoard | null
  changes: AgentChange[]
  canRevert: boolean
}

export interface AgentModelSettingsView {
  baseUrl: string
  model: string
  hasApiKey: boolean
}

export type AgentAction =
  | { action: 'message'; text: string }
  | { action: 'accept' }
  | { action: 'revert' }
  | { action: 'stop' }
