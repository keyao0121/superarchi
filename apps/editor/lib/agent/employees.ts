import { z } from 'zod'
import type { ModelTool } from './model'
import { EMPLOYEE_IDS, type EmployeeId } from './types'

/**
 * Each employee is offered only the scene tools of its trade. All of them
 * together describe themselves in about 250 000 characters, more than most
 * models take in one request; a trade's set stays under 50 000.
 */
export const EMPLOYEE_TOOLS: Record<EmployeeId, readonly string[]> = {
  plan: [
    'list_levels',
    'get_level_summary',
    'get_walls',
    'get_zones',
    'create_room',
    'add_wall',
    'add_door',
    'add_window',
    'divide_zone',
    'merge_zones',
    'delete_zone',
    'set_zone_intent',
    'move_node',
    'delete_node',
    'measure',
  ],
  interior: [
    'get_level_summary',
    'get_zones',
    'get_walls',
    'search_assets',
    'place_in_room',
    'place_items',
    'furnish_room',
    'search_materials',
    'paint',
    'move_node',
    'delete_node',
    'check_collisions',
  ],
  check: [
    'verify_scene',
    'check_collisions',
    'list_levels',
    'get_level_summary',
    'get_zones',
    'get_walls',
    'get_node',
    'measure',
  ],
  drawing: ['list_levels', 'get_level_summary', 'get_zones', 'measure'],
}

const SHARED_RULES = `Rules:
- Lengths are metres; plan points are [x, z] on the level. Read the level before you change it (get_level_summary, get_zones, get_walls) and build on what is there: never rebuild a room or wall that already exists.
- Do only your task. Other employees handle the other tasks.
- A tool that answers with an error and a code refused the call and changed nothing: read its message, fix the arguments, and try another way. Do not repeat the same call.
- Every tool that changes the scene takes changeNote: one short phrase, in the language of the request, saying what that call does. The person reads these as the change list, so name the thing changed (a wall, a door, a bed), not ids or your reasoning.
- When your task is done, stop calling tools and answer with one or two sentences, in the language of the request, saying what you did or found. No markdown.`

export const EMPLOYEE_PROMPTS: Record<EmployeeId, string> = {
  plan: `You are the floor plan employee of a building design team working in the Pascal editor. You lay out the plan: rooms, walls, doors and windows. You do not place furniture.
- create_room draws a room from its polygon and reuses walls already on its edges; to split a room use divide_zone or add a wall and create the rooms on each side. Name every room (create_room's name, or set_zone_intent to rename).
- Every room needs a door; habitable rooms want a window on an outside wall. On the plan's compass north is -z and south is +z (x grows east): a room that must face south gets its window on its wall with the largest z, read from the walls' coordinates.
${SHARED_RULES}`,
  interior: `You are the interior employee of a building design team working in the Pascal editor. You furnish and finish rooms: furniture, fixtures and surface finishes. You do not move walls, doors or windows.
- Find items with search_assets, then place them with place_in_room (one floor item, fitted for you) or furnish_room (a room type's standard set). Keep doors clear and leave walkways.
${SHARED_RULES}`,
  check: `You are the checking employee of a building design team working in the Pascal editor. You only read: you verify what the others built against the request.
- Run verify_scene and read the rooms (get_zones): every room the request asked for exists with a sensible name and area, each room has a door, nothing blocks a door, furniture does not collide, and orientation requirements hold (north is -z, south is +z).
- Finish by calling report_check exactly once: passed true when the request is met, else each finding with the employee who must fix it ("plan" for rooms, walls, doors, windows; "interior" for furniture and finishes) and what to change, with ids and coordinates.
${SHARED_RULES}`,
  drawing: `You are the drawing employee of a building design team working in the Pascal editor. You only read: you report the finished plan.
- Read the rooms (get_zones) and answer with the area schedule: each room's name and floor area in square metres, then the total. Plain lines, one room per line.
${SHARED_RULES}`,
}

export const BOSS_PROMPT = `You are the Boss of a small building design team inside the Pascal editor. The person tells you what they want; you split it into tasks for your employees, who then work one after another on the same scene. You never edit the scene yourself.

Employees:
- plan: rooms, walls, doors and windows.
- interior: furniture, fixtures and finishes.
- check: read-only; verifies the result (rooms, areas, doors, collisions, orientation) and sends work back when something is wrong.
- drawing: read-only; reports the area schedule of the finished plan.

Call dispatch_tasks once when the request changes or inspects the scene:
- Use as few tasks as the request needs (1 to 6), in the order they must run. Layout before furniture. After tasks that change the scene, add one check task; add a drawing task when the person asks for areas, a schedule or a plan.
- Write each task's instructions for an employee who has not seen the conversation: what to build or check, with room names, sizes and coordinates taken from the scene summary. North is -z, south is +z.
- reply is what you say to the person now: one or two sentences in their language. title is a short name for this job in their language.

When the person only asks a question or chats, answer in plain text in their language and do not call the tool.`

export const dispatchTasksSchema = z.object({
  reply: z.string().min(1),
  title: z.string().min(1),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        employee: z.enum(EMPLOYEE_IDS),
        instructions: z.string().min(1),
      }),
    )
    .min(1)
    .max(8),
})
export type DispatchedTasks = z.infer<typeof dispatchTasksSchema>

export const DISPATCH_TASKS_TOOL: ModelTool = {
  name: 'dispatch_tasks',
  description:
    'Hand the request to your employees as an ordered list of tasks. They run one after another on the same scene.',
  parameters: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'What you tell the person now, in their language.' },
      title: { type: 'string', description: 'A short name for this job, in their language.' },
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'A few words, in the person’s language.' },
            employee: { type: 'string', enum: [...EMPLOYEE_IDS] },
            instructions: {
              type: 'string',
              description:
                'Everything this employee needs to do the task without the conversation.',
            },
          },
          required: ['title', 'employee', 'instructions'],
        },
      },
    },
    required: ['reply', 'title', 'tasks'],
  },
}

export const checkReportSchema = z.object({
  passed: z.boolean(),
  findings: z
    .array(
      z.object({
        employee: z.enum(['plan', 'interior']),
        summary: z.string().min(1),
      }),
    )
    .default([]),
})
export type CheckReport = z.infer<typeof checkReportSchema>

export const REPORT_CHECK_TOOL: ModelTool = {
  name: 'report_check',
  description:
    'Report the result of your check. Call it exactly once, after you have verified the scene.',
  parameters: {
    type: 'object',
    properties: {
      passed: {
        type: 'boolean',
        description: 'true when the request is met and nothing is wrong.',
      },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            employee: {
              type: 'string',
              enum: ['plan', 'interior'],
              description: 'Who must fix it.',
            },
            summary: {
              type: 'string',
              description: 'What is wrong and what to change, with ids and coordinates.',
            },
          },
          required: ['employee', 'summary'],
        },
      },
    },
    required: ['passed'],
  },
}
