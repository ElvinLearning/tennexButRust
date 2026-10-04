why is rust important

For this project, honestly, Rust doesn't matter much. The server mostly forwards text from a model to the browser and waits on the network, and Node handles that fine. The 3D office, voice and monitors run in the browser as JavaScript either way, so most of the app didn't change.

What Rust did get you here:

- One file to run. cargo build --release gives you a single tennex binary. No node_modules and no Node install, so it's easy to copy to another machine or a server.
- Low resource use. It idles at a few MB of memory and starts instantly. That's nice on a laptop or a cheap VPS, but you won't notice it with one player.
- Errors caught early. The compiler forces every failure path to be handled, like a bad request, an unreachable provider or a dropped stream. That fits the spec's "errors show as a readable message, never a blank screen."
- Cancellation comes for free. When the player walks away mid-reply, the request to the model is dropped automatically, with no cleanup code to forget. That's the spec's cost rule, and a test covers it.

The costs:

- Slower to change. Builds take minutes (the release build took about 5 here), versus instant reloads with Vite.
- Two languages. You now have Rust for the sclient, where the Node version was JavaScript throughout.

Where Rust in general really shines is where matter most: browsers, operating systems,game engines, databases, embedded devices, and high-traffic servers. It's as fast as C/C++, but the compiler rules out whole classes of bugs, like crashes from bad between threads.





# Tennex Office (Rust)

A 3D office in the browser where you walk around in first person, watch five AI agents work at their desks, look over their shoulders at their monitors, and give them tasks by voice or text. The full spec is in [docs/SPEC.md](docs/SPEC.md).

The server is Rust (axum + tokio + reqwest). The client is plain JavaScript with Three.js, served as static files; there is no build step and no Node needed at runtime.

## Run it

```sh
cp .env.example .env      # optional: add an API key to go live
cargo run --release       # → http://127.0.0.1:8787
```

With no keys set, every agent runs in **offline sim mode** with canned replies, so you can try everything straight away.

Open the page in Chrome or Edge for voice. Firefox and Safari work too, but with typing only.

| Keys | |
|---|---|
| `W A S D` / arrows, `Shift` | walk, sprint |
| hold `V` | push-to-talk to the agent you're next to (or say a name first) |
| `Enter` | type a message: `@name` chips, `Tab` completes |
| `F` | fly to the nearby agent's monitor; `F`/`Esc` to return |
| `C` (in close-up) | full text with **Copy all** |
| `Esc` | pause: pick a model per agent, or for everyone |

Addressing: `team, …` goes to everyone. `Critic, …`, `@critic …` or `hey critic …` go to Critic. Otherwise the message goes to whoever you're standing next to. `/brief <text>` sets a project brief for every agent (presets: `roblox`, `cozy`, `higgsfield`, `wolf`; `/brief clear` removes it).

## Providers

Set any of these in `.env` (see `.env.example`). Only providers that are configured, and models that are reachable, show up in the pause menu.

| Provider | Model ids | Configure with |
|---|---|---|
| Claude | `claude:claude-opus-5-5`, … | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODELS`, `CLAUDE_EFFORT` |
| Nous Research (Hermes) | `nous:Hermes-4-70B`, … | `NOUS_API_KEY`, `NOUS_MODELS` |
| Ollama (local) | `ollama:<name>` (auto-discovered) | `OLLAMA_URL` (default `http://localhost:11434`, `off` to disable) |
| OpenRouter | `openrouter:<slug>` | `OPENROUTER_API_KEY`, `OPENROUTER_MODELS` |
| Any OpenAI-compatible URL | `custom:<name>` | `OPENAI_COMPAT_URL`, `OPENAI_COMPAT_MODELS`, `OPENAI_COMPAT_KEY` |

Claude requests stream from the Messages API with `output_config.effort` (default `low`, to keep spoken replies quick). On `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-fable-5-1` they also turn on server-side refusal fallback (`fallbacks: "default"`), so a safety-classifier decline is retried on a fallback model instead of stopping the reply. Remove that block in `src/providers.rs` if you don't want it.

Check that each configured provider really answers:

```sh
cargo run -- doctor
```

## Test

```sh
cargo test
```

This runs:
- **Server unit tests:** input validation, message building, provider request shapes, upstream event parsing, and the SSE decoder.
- **API integration tests** (`tests/api.rs`) against a mock OpenAI-compatible upstream: streaming, a server-owned system prompt, 400/413 rejections, readable upstream errors, and cancelling the upstream request when the player leaves mid-reply.
- **Client logic tests** (`tests/js/*.test.mjs`): the streaming `SAY:`/`SCREEN:` parser, message routing, `/brief` and sim replies. Cargo runs them through `node --test` if Node is installed; you can also run `node --test tests/js/*.test.mjs` directly.

## Layout

```
src/
  main.rs        server entry: static files + API, `doctor` subcommand
  api.rs         GET /api/health, POST /api/chat (SSE), input validation, 200 KB limit
  providers.rs   provider registry, Claude + OpenAI-compatible streaming, error messages
  agents.rs      the five agents and their server-side system prompts
  sse.rs         incremental SSE decoder for upstream streams
  doctor.rs      provider health check
public/
  index.html, style.css
  js/main.js       scene, player, collisions, agent life, chat flow
  js/office.js     room, furniture, props, wall display (all generated in code)
  js/character.js  agent figures, chairs, name tags
  js/monitor.js    per-role monitor canvases (≤ 20 redraws/s)
  js/replyParser.js streaming SAY/SCREEN parser + sentence splitter
  js/router.js     who a message is for, @mention autocomplete
  js/voice.js      push-to-talk + one-agent-at-a-time speech queue
  js/ui.js         overlays, roster, prompt box, full-text viewer, toasts
  js/sim.js        offline canned replies
  js/brief.js      /brief command + presets
  vendor/three.module.js  Three.js r170 (MIT), vendored so the office works offline
tests/
  api.rs, client_js.rs, js/*.test.mjs
```

## Differences from the spec's tech constraints (§10–11)

The spec was written for a Node/Vite stack. In this Rust port:

| Spec | Here |
|---|---|
| Node 20+ server, no web framework | Rust server (axum). Same API contract (§7) and the same security, cost and resilience rules (§8). |
| Three.js + Vite, plain JS | Three.js + plain JS ES modules served as-is. No bundler, so there is no build step. |
| `npm test` | `cargo test` (also runs the client JS tests via Node when it's installed) |
| `npm run build` | `cargo build --release` |
| `npm run doctor` | `cargo run -- doctor` |
| `npm start` | `cargo run --release`, or run `target/release/tennex` from the repo root (set `PUBLIC_DIR` to serve `public/` from somewhere else) |

`window.tennex` in the browser console exposes a small debug handle (`handleInput`, `states`, `player`, `focus`, …) for poking at the office by hand.
