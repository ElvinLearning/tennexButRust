# Tennex Office — Product Spec

**Status:** v1 shipped · **Owner:** you · **Last updated:** 2026-09-30

> This is the spec you would hand an AI (or a human team) to build Tennex from scratch.
> Every requirement has an ID and acceptance criteria you can check with a yes/no.

---

## 1. One-line summary

A 3D office in the browser where you walk around in first person, watch five AI agents work at their desks, see their screens, and give them tasks by voice or text.

## 2. Problem and goal

Chatting with an AI in a text box feels like filling in a form. The goal is to make directing several AI agents feel like walking into a studio: you see who is busy, look over their shoulder, and talk to them.

**Success looks like:** a first-time user can walk to an agent, ask for something, and read the result on that agent's monitor within 60 seconds, without instructions beyond the start screen.

## 3. Users

| User | What they want |
|---|---|
| Solo builder (primary) | Get real work (code, plans, tests, commands) from several specialised agents at once |
| Presenter / demo audience | Something visual that shows "AI agents doing work" at a glance |

## 4. Scope

**In scope (v1)**
- One office room, five agents with fixed roles, first-person walking
- Voice and text prompts; spoken and on-screen replies
- Choosing an AI model per agent; an offline mode with canned replies
- A shared "project brief" all agents see

**Out of scope (v1)** — explicitly not building these yet
- Agents running code, calling APIs or editing files (no tools)
- Multiplayer or accounts
- Mobile / touch controls
- Saving conversations to a server

## 5. The agents

| ID | Name | Role | Their monitor shows |
|---|---|---|---|
| `tenx` | Tenx | Lead Engineer | code editor |
| `assert` | Assert | QA Engineer | test runner |
| `vector` | Vector | Product Lead (directs roleplay) | plans and briefs |
| `deploy` | Deploy | Platform Engineer (CI, deploys, APIs) | terminal |
| `critic` | Critic | Principal Reviewer | code-review diffs |

Every agent follows shared working standards: deliver usable output, state assumptions instead of stalling, **never claim to have run anything or invent results**, and hand off to a teammate by name.

## 6. Requirements

Each requirement: **what** it does, then **acceptance criteria (AC)** that must all pass.

### R1 — Walk around the office
First-person controls with mouse look.
- **AC1** `W A S D` / arrow keys move; `Shift` sprints (3.6 → 7 m/s).
- **AC2** The player cannot walk through walls, desks, furniture or agents (player radius 0.3 m).
- **AC3** Eye height is 1.65 m; clicking "Enter the office" locks the mouse; `Esc` pauses.

### R2 — Talk to an agent by voice (push-to-talk)
- **AC1** Holding `V` starts listening; releasing `V` sends what was heard.
- **AC2** A live caption shows the words while you speak.
- **AC3** Starting to talk interrupts any agent who is currently speaking.
- **AC4** If the browser has no speech recognition, pressing `V` shows a message telling the user to press `Enter` and type.

### R3 — Type to an agent
- **AC1** `Enter` opens a text box showing every agent as a clickable `@name` chip with their role.
- **AC2** Typing `@` + letters highlights matching agents; `Tab` completes the name.
- **AC3** The box shows who the message will go to before sending (`→ Critic`).

### R4 — Decide who a message is for
Rules, in order:
1. Starts with `team,` / `everyone,` → all five agents.
2. Starts with an agent's name (`Critic, …`, `@critic …`, `hey critic …`) → that agent.
3. Contains exactly one `@name` anywhere → that agent.
4. Otherwise → the agent you are standing next to.
- **AC1** Names that are also verbs (`deploy`, `assert`) only count as an address with `@`, a greeting, or punctuation: "deploy it to staging" goes to the agent you're facing, not to Deploy.
- **AC2** Common speech-recognition spellings work: "10x" and "ten x" reach Tenx.
- **AC3** If nobody is addressed or nearby, show "Nobody heard …" and send nothing.

### R5 — Agent replies drive voice *and* monitor
The model must answer in this exact format:
```
SAY: <1-3 short sentences, read aloud>
SCREEN:
<the actual work, shown on the agent's monitor>
```
- **AC1** Speech starts at the first finished sentence, before the reply is complete.
- **AC2** The monitor fills in as the reply streams.
- **AC3** The words `SAY:` / `SCREEN:` never appear in speech or on screen, even when a chunk boundary splits them (e.g. `SCR` + `EEN:`).
- **AC4** A reply with no `SCREEN:` section is treated as speech only.

### R6 — Watch an agent's screen
- **AC1** Standing behind an agent shows their monitor over their shoulder.
- **AC2** `F` flies the camera to a close-up of the monitor; `F` or `Esc` returns.
- **AC3** In close-up, the mouse wheel scrolls long output; `C` opens the full text with a **Copy all** button.

### R7 — Choose each agent's AI model
- **AC1** The pause screen lists every agent with a model dropdown, plus one "Everyone" dropdown.
- **AC2** Only models that are actually configured and reachable are offered, plus "Sim (offline)".
- **AC3** Choices are remembered in the browser and shown under each name in the roster.
- **AC4** Supported providers: Claude, Nous Research (hosted Hermes), Ollama (local), OpenRouter, any OpenAI-compatible URL.

### R8 — Project brief
- **AC1** `/brief <text>` sets a brief sent to every agent with every prompt; `/brief clear` removes it.
- **AC2** Presets: `/brief roblox`, `cozy`, `higgsfield`, `wolf`.
- **AC3** The brief is shown on the office wall display.

### R9 — Agents feel alive
- **AC1** Idle agents type, blink, and occasionally walk to the coffee machine, whiteboard, wall display or server rack, then return to their desk.
- **AC2** An agent you walk up to turns their head (and chair) toward you.
- **AC3** Each agent's name tag shows a status: autopilot · listening · thinking · shipping · talking · on a break · crashed.

## 7. Interfaces

### `GET /api/health`
```json
{ "live": true,
  "models": [{ "id": "nous:Hermes-4-70B", "label": "Hermes-4-70B", "provider": "Nous Research (Hermes)" }],
  "defaultModel": "nous:Hermes-4-70B" }
```

### `POST /api/chat`
Request:
```json
{ "agentId": "tenx", "model": "nous:Hermes-4-70B", "prompt": "build a leaderboard",
  "history": [{ "role": "user", "content": "…" }], "office": ["recent feed lines"], "brief": "…" }
```
Response: a `text/event-stream` of `data: {"t":"<text chunk>"}`, ending with `data: {"done":true}` or `data: {"error":"<readable message>"}`.

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | API keys live only on the server (`.env`); the browser never sees them. The server picks the agent's system prompt; the browser cannot send its own. Unknown agents and unconfigured models are rejected (HTTP 400). Request bodies over 200 KB are rejected. |
| Cost | If the player leaves mid-reply, the server cancels the model request. |
| Performance | Smooth on a laptop with integrated graphics; pixel ratio capped at 1.75; monitors redraw at most 20×/second. |
| Resilience | With no models configured, everything still works in offline sim mode. Errors show as a readable message on the agent's screen and in a toast, never a blank screen. |
| Browsers | Latest Chrome/Edge (voice included), Firefox/Safari (typing only). |

## 9. Edge cases

- Model thinks in `<think>…</think>` tags → hidden from voice and screen.
- Two prompts to the same agent → the first is cancelled, the second answered.
- Browser blocks the clipboard → the text is pre-selected so `Ctrl/Cmd+C` works.
- Ollama not running → its models simply don't appear; no error.

## 10. Tech constraints

- Three.js + Vite, plain JavaScript (ES modules), no UI framework.
- Node 20+ server with no web framework; the same API code runs inside the Vite dev server and in production (`npm start`).
- All 3D assets are generated in code (no model files to download).

## 11. Definition of done

- [ ] Every AC above passes by hand in Chrome.
- [ ] `npm test` passes (reply parser, routing, API input handling, providers).
- [ ] `npm run build` succeeds.
- [ ] `npm run doctor` shows each configured provider answering a test message.

## 12. Next steps to implement

- agents get tools (run code, call Higgsfield) in v2, and which need human approval first?
- conversations persist across page reloads?
