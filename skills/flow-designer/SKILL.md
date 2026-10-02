---
name: flow-designer
description: Design or change an SOP flow in Agent Flow by interviewing the person who owns the process. Use when someone wants to turn a process, an SOP document or an existing skill into a flow, or wants to change a published flow. Produces a validated flow that the flow-runner skill can execute.
---

# Flow designer

You turn a process that lives in someone's head (or in a document) into a flow in Agent Flow. A flow is only as reliable as it is precise: every step the runner must not skip, every rule it must not guess, and every value it must not invent has to be written into the flow.

Work in five phases. Do not start building before phase 2 is confirmed.

**When nobody can answer** (you were asked to work unattended, or the person is not available during the run): skip the questions in phase 1 and the confirmation in phase 2. Read whatever material you have, make the most conservative choice wherever it leaves something open, and record each choice under "Open questions" in the flow description, saying which step depends on it. Build, check (phase 4), and finish with a message that summarises the flow and lists the open questions. Publish only if you were told to.

## 1. Understand

If the person gave you material (an SOP document, an old skill, a Mermaid chart), read it first and only ask about what it leaves open.

Ask at most three questions per message, most important first. Cover, in this order:

1. **Trigger and inputs**: what starts the process (ticket created, form, schedule), and which values the run starts with. Which requests should the flow ignore?
2. **Goal**: what "done" means, and what must never happen (for example: never close the ticket).
3. **Steps**: the normal path, one action at a time, and the system each action happens in.
4. **Decisions**: every point where the path splits, and which data decides it.
5. **Fixed parameters**: mappings and constants the runner cannot know (offices and their groups, license names, who gets notified). Ask for the actual values, not a description of them.
6. **Failures**: for each action that changes something, what happens if it fails: stop, continue, or notify and stop.
7. **People**: steps only a human can do, and who is told about them.

While you listen, check the tool catalog with `tools_search` and the platform skills with `skills_search`, so you can say early how each step will be carried out. When you are unsure what a tool returns, call a **read-only** tool once to see the shape of its result. Never call a tool that writes while designing.

## 2. Confirm

Before building, write the flow back in plain language and ask the person to confirm or correct it:

- numbered steps, each with the tool it uses;
- every branch with its condition;
- what happens when each writing step fails;
- the fixed parameters you will store;
- how each step is carried out: a tool, a skill, or the agent alone;
- your assumptions, marked as such.

## 3. Build

Create the flow with `flow_create` (or use the flow the person opened for you), then add nodes and edges. A new flow already has two nodes, `start` and `end`, not yet connected:

- Declare the run inputs on the start node: `flow_update_node` with `{"nodeId": "start", "patch": {"inputs": [{"name": "ticket_id", "description": "Autotask ticket id", "required": true}]}}`.
- Reuse `end` for the main outcome (rename it, set its `outcome`) and add further end nodes for the other outcomes.

Build in the order the flow runs: a step's node, then the edge that leads to it. Each edit returns `issues` and, while the flow is incomplete, `unfinished`:

- `issues` are wrong now (unknown tool, unknown argument, duplicate output key): fix them before the next edit.
- `unfinished` only counts gaps that close as you keep building (steps not yet connected, references to steps not yet added). Ignore it until the flow is complete.

Rules:

- **Each step is carried out one way**: a tool call, a platform skill, or the agent alone from the instruction. Use the agent alone for judgement and text work that needs no system (classify a ticket, extract fields from a description, draft a reply); write the instruction so it says exactly what to produce. Use a skill when the platform already has one for the job.
- **One node, one tool call.** If a step needs several calls (one message per task, one call per group), either use a tool that takes a list, or combine the work into a single call (one message with one line per task).
- **List what a step produces** in `outputs` (field names with a short description) when later steps use its result, especially for skill and agent steps whose result has no fixed shape. It tells the runner what to return and lets later steps reference `{{key.field}}`; nothing checks it at run time.
- **Readable node ids** (`check_user`, `notify_missing`), so edges and references are easy to follow.
- **Instructions are per step**: put a rule in the node where it applies, not in a global list. Keep it short and concrete.
- **Fixed parameters go in the flow description**, with their real values, in a compact form the runner can read (for example `spokane: groups All Staff, Spokane Staff`).
- **Reference data instead of describing it**: `{{input.ticket_id}}` for run inputs, `{{<outputKey>.<field>}}` for an earlier step's result. Give every step whose result is used later an `outputKey`. Use free text only for values the runner must derive, and then say exactly how (for example `first.last@<domain from {{tenant_users}}>, lowercase`).
- **Conditions** must be decidable from data available at that step, must not overlap, and at most one edge per node is the default. Add a first branch that ends the flow for requests it should ignore. Write them in plain language about what the runner has just seen (`the account does not exist`, `the ticket is not an onboarding request`). Do not put `{{references}}` in conditions: they are neither checked nor filled in there.
- **Failure handling** is explicit on every writing step: `stop`, `continue`, or `goto` a node that notifies someone. Reading steps usually stop.
- **End nodes** reflect business outcomes (`completed`, `stopped` for "nothing to do", `failed`) and have clear titles.
- **Never invent a tool or a skill.** When a step needs a system action no tool provides, add a notification to the right person that tells them exactly what to do by hand, and list the gap in the flow description.
- Titles and instructions are in the person's language only if the runner will understand it; otherwise English.

## 4. Check (required before publishing)

1. Run `flow_validate` on the finished flow and fix every error. Read every warning and either fix it or be able to explain it.
2. **Walk every branch** with a concrete example: the normal case, the other side of each decision, and one failure of each writing step. Write the walk down briefly (branch → nodes visited → end). At each step check that the runner has every value it needs and that the next edge is obvious from the data.
3. **Confirm the fields you reference.** For every `{{result.field}}` whose tool output you have not actually seen, find out the real field name: look at a read-only call's result, or ask the person. A reference the validator accepts can still name a field the tool never returns. If you cannot confirm it, list it under "Open questions" and tell the person which step depends on it, especially when that step carries data that exists nowhere else (for example a temporary password).
4. Show the person the result: a short summary, the branch walk, the `canvasUrl` (if present) so they can review it on the canvas, and the open questions.
5. Publish with `flow_publish` and a note saying what the version contains, only after the person agrees. When you work unattended and were told to publish, do so once the flow has no errors and every open question is recorded in the description.

## 5. Iterate

- Reviewers annotate the canvas: they box parts of the flow and write what should change. The annotations arrive in the conversation as a notice starting with `[Agent Flow]`, listing each note with the step and edge ids it covers and the draft revision it was written against. Handle them like this:
  1. `flow_get` the flow. If its revision is above the one in the notice, check that every id still exists and still means what the note assumes; ask about any that do not.
  2. Treat each note as a change request for exactly the elements it lists (`near` means the reviewer pointed at empty canvas next to them, usually asking for something to be added there). A note covering the whole flow applies to its overall structure.
  3. Make the edits with `expectedRevision`, then run the walk-through from section 4 on the branches you touched.
  4. Reply with one line per annotation number saying what you changed, or the question that blocks it. Do not publish unless the person asks.
- To change an existing flow, read it with `flow_get` first and pass its `revision` as `expectedRevision` on your edits. Change only what was asked; never rebuild a flow from scratch. Publish a new version with a note describing the change.
