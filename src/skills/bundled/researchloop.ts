/**
 * researchloop — Autonomous AI task execution combining Ralph Loop + autoresearch
 *
 * Methodology:
 * - **Ralph Loop**: Stateless context management via files, context rotation before pollution,
 *   guardrails accumulation from failures, simple while-loop structure.
 * - **autoresearch**: Fixed time budget per iteration, single-file modification scope,
 *   metric-based decision making, rapid autonomous experimentation.
 *
 * This skill forces the agent to autonomously work on complex tasks by:
 * 1. Creating a workspace with state files (task.md, progress.md, guardrails.md)
 * 2. Iterating through plan→execute→evaluate cycles via Agent subagents
 * 3. Each subagent handles one iteration with a fresh context (natural rotation)
 * 4. Learning from failures and accumulating guardrails across iterations
 */

import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DEFAULT_MAX_ITERATIONS = 72
const DEFAULT_TIME_BUDGET_MINUTES = 30

const USAGE_MESSAGE = `Usage: /researchloop <task description>

Autonomously execute a task using the combined Ralph Loop + autoresearch methodology.

The agent will:
- Create a workspace with state files (task.md, progress.md, guardrails.md)
- Iterate through plan→evaluate-plan→execute→evaluate cycles, each in a fresh Agent subagent
- Accumulate guardrails from failures across iterations

Options:
  --iterations <N>    Max iterations (default: ${DEFAULT_MAX_ITERATIONS})
  --time-budget <M>   Time budget in minutes (default: ${DEFAULT_TIME_BUDGET_MINUTES})

Examples:
  /researchloop "Implement a REST API for user management with CRUD operations"
  /researchloop --iterations 20 "Build a small game similar to Snake using HTML5 canvas"
  /researchloop "Analyze this codebase and suggest performance improvements"`

function buildIterationAgentPrompt(): string {
	return `You are one iteration of a researchloop. Your job is to:

1. **READ STATE** — Use \`${FILE_READ_TOOL_NAME}\` to load:
   - \`.researchloop/task.md\` (original task and success criteria)
   - \`.researchloop/progress.md\` (what has been done, current state, next steps)
   - \`.researchloop/guardrails.md\` (lessons from past failures — you MUST follow these)

2. **PLAN** — Based on the state, decide the single most impactful next action.
   - Respect every guardrail in guardrails.md without exception.
   - Be specific: name the exact files, commands, or steps you will execute.

2.5. **EVALUATE PLAN** — Before executing, call \`${AGENT_TOOL_NAME}\` with:
   - \`subagent_type\`: \`"agent-answer-evaluator"\`
   - \`prompt\`: A description of your plan including:
     - The task's success criteria (from task.md)
     - The current guardrails (from guardrails.md)
     - Your proposed plan in detail
     - Ask the evaluator: "Is this plan valid, safe, and likely to make progress toward the success criteria without violating any guardrails?"
   - If the evaluator identifies flaws or violations, **revise your plan** before proceeding to execute.

3. **EXECUTE** — Do the work using these tools:
   - \`${FILE_READ_TOOL_NAME}\`, \`${FILE_WRITE_TOOL_NAME}\`, \`${FILE_EDIT_TOOL_NAME}\` for file operations
   - \`${BASH_TOOL_NAME}\` for running commands, tests, builds
   - \`${GLOB_TOOL_NAME}\`, \`${GREP_TOOL_NAME}\` for exploring the codebase
   - Place generated artifacts in \`.researchloop/artifacts/\`

4. **EVALUATE** — Did the action succeed?
   - Use concrete metrics where possible (tests pass/fail, build output, file exists, etc.)
   - If it failed, identify the root cause.

5. **UPDATE STATE** — Use \`${FILE_WRITE_TOOL_NAME}\` or \`${FILE_EDIT_TOOL_NAME}\` to update:
   - \`.researchloop/progress.md\` — document what you did, what succeeded/failed, and the next steps
   - \`.researchloop/guardrails.md\` — if a failure revealed a pattern, append a new Sign:

\`\`\`markdown
### Sign: <descriptive title>
- **Trigger**: When <condition>
- **Instruction**: <what to do differently>
- **When added**: Iteration N — <brief reason>
\`\`\`

6. **EXIT with status** — End your response with exactly one of:
   - \`STATUS: DONE\` — task.md success criteria are fully met
   - \`STATUS: CONTINUE\` — more work is needed
   - \`STATUS: BLOCKED\` — blocked by something requiring human input (explain briefly)`
}

function buildPrompt(args: string, maxIterations: number, timeBudgetMinutes: number): string {
	return `# /researchloop — Autonomous Task Execution

You are the **coordinator** for a researchloop. Follow these phases exactly, using the specified tools.

## Phase 0: Parse Input

Parse the task description and options from the input below.
If the task is ambiguous or underspecified, call \`${ASK_USER_QUESTION_TOOL_NAME}\` to clarify before proceeding.

## Phase 1: Workspace Setup

Use \`${FILE_WRITE_TOOL_NAME}\` to create these files (overwrite if they already exist):

**\`.researchloop/task.md\`** — fill in from the parsed task:
\`\`\`markdown
# Task

<original task description>

## Success Criteria

<list specific, verifiable criteria — be concrete, not vague>

## Constraints

- Max iterations: ${maxIterations}
- Time budget: ${timeBudgetMinutes} minutes
<any additional constraints from the user input, e.g. technology choices>

## Started

<current timestamp>
\`\`\`

**\`.researchloop/progress.md\`** — initial state:
\`\`\`markdown
# Progress

## Status
Not started

## Completed Steps
(none yet)

## Next Steps
1. Begin initial research/planning

## Iteration Log
(none yet)
\`\`\`

**\`.researchloop/guardrails.md\`** — initially empty:
\`\`\`markdown
# Guardrails

Lessons learned from failures. All future iterations MUST read and follow every Sign below.

(none yet)
\`\`\`

Then run \`${BASH_TOOL_NAME}\` with \`mkdir -p .researchloop/artifacts\` to create the artifacts directory.

## Phase 2: Iteration Loop

Run up to **${maxIterations} iterations** within a **${timeBudgetMinutes}-minute time budget**. For each iteration:

1. Call \`${AGENT_TOOL_NAME}\` with:
   - \`subagent_type\`: \`"general-purpose"\`
   - \`run_in_background\`: \`false\` (wait for result before next iteration)
   - \`prompt\`: the exact text of the iteration agent prompt below

2. Parse the agent's final response for the STATUS line:
   - \`STATUS: DONE\` → stop the loop, go to Phase 3 (success)
   - \`STATUS: CONTINUE\` → run the next iteration
   - \`STATUS: BLOCKED\` → call \`${ASK_USER_QUESTION_TOOL_NAME}\` to get unblocked, then continue

3. If max iterations (${maxIterations}) is reached or the time budget (${timeBudgetMinutes} minutes) is exceeded without DONE, go to Phase 3 (partial).

### Iteration Agent Prompt (pass verbatim to every Agent call)

\`\`\`
${buildIterationAgentPrompt()}
\`\`\`

## Phase 3: Deliver

When the loop ends, report to the user:
- **Outcome**: DONE / PARTIAL (max iterations reached) / BLOCKED
- **Summary**: what was accomplished, referencing \`.researchloop/progress.md\`
- **Artifacts**: list files in \`.researchloop/artifacts/\` using \`${GLOB_TOOL_NAME}\`
- **Guardrails learned**: show final \`.researchloop/guardrails.md\` contents

---

## Input

${args}`
}

function parseArgs(args: string): { task: string; maxIterations: number; timeBudgetMinutes: number } {
	let maxIterations = DEFAULT_MAX_ITERATIONS
	let timeBudgetMinutes = DEFAULT_TIME_BUDGET_MINUTES
	let remaining = args

	const iterMatch = remaining.match(/--iterations\s+(\d+)/)
	if (iterMatch) {
		maxIterations = parseInt(iterMatch[1], 10)
		remaining = remaining.replace(iterMatch[0], '').trim()
	}

	const timeMatch = remaining.match(/--time-budget\s+(\d+)/)
	if (timeMatch) {
		timeBudgetMinutes = parseInt(timeMatch[1], 10)
		remaining = remaining.replace(timeMatch[0], '').trim()
	}

	return { task: remaining, maxIterations, timeBudgetMinutes }
}

export function registerResearchLoopSkill(): void {
	registerBundledSkill({
		name: 'researchloop',
		description:
			'Autonomous task execution using Ralph Loop + autoresearch methodology (state files, context rotation via Agent subagents, guardrails)',
		whenToUse:
			'When the user wants autonomous, iterative work on a complex task that benefits from: test-driven development, mechanically verifiable success criteria, or sustained effort over multiple iterations. NOT for simple one-off questions or tasks requiring deep human judgment.',
		argumentHint: '<task description>',
		userInvocable: true,
		disableModelInvocation: true,
		async getPromptForCommand(args) {
			const trimmed = args.trim()
			if (!trimmed) {
				return [{ type: 'text', text: USAGE_MESSAGE }]
			}
			const { task, maxIterations, timeBudgetMinutes } = parseArgs(trimmed)
			return [{ type: 'text', text: buildPrompt(task, maxIterations, timeBudgetMinutes) }]
		},
	})
}
