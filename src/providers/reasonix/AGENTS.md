# Reasonix Provider Agent Instructions

`src/providers/reasonix/` adapts the Reasonix CLI through ACP using `reasonix acp` over stdio JSON-RPC.

## Current Scope

- Reasonix is opt-in and disabled by default.
- Chat execution runs through the kernel: `ReasonixExecution` (`src/providers/reasonix/execution/`) owns the backend, the permission bridge and the isolated metadata session, and `ApplicationRuntime.createRuntimeFor('reasonix')` reaches it through the composition.
- Per-turn prompts include Grimoire context from the active note, editor selection, browser selection, canvas selection, vault search, and project workspace.
- Model and mode discovery come from the `session/new` and `session/load` replies, which answer in ACP's own vocabulary: `models` (`availableModels`, `currentModelId`), `modes` (`normal`, `plan`, `goal`), and `configOptions` (`model`, `effort`, `tool_approval`, `quality_floor`). **The session is the source, not the config file**: the CLI resolves `./reasonix.toml` over `~/.reasonix/config.toml` over its built-in defaults, and between them they list the providers an account could reach, while the session offers only the models a provider block actually serves. Different configurations offer different lists; that is expected.
- **One Grimoire mode is two calls.** Reasonix separates the session mode from the approval posture, so `modes.ts` maps Safe to `normal` + `tool_approval: ask`, Plan to `plan` + `ask`, and Auto-approve to `normal` + `tool_approval: yolo`. The mode goes through `session/set_mode` and the posture through `session/set_config_option`; both were probed on 2026-09-09. **A refused posture fails the turn; a refused mode does not.** Ordering cannot make the pair safe, which an earlier version of this file claimed and got wrong: Safe and Auto-approve are the *same* session mode, so the posture is the only thing separating them, and a swallowed failure leaves somebody who asked for Safe running on `yolo` whichever call went first. The posture is the permission boundary, so a turn that cannot establish it is not dispatched. The mode is behaviour rather than permission, so a refusal is reported and the turn runs in the mode the session already had — named in Grimoire's vocabulary rather than the wire's, since `normal` is the wire value for both Safe and Auto-approve.
- **A reported `normal` must never demote Auto-approve.** Safe and Auto-approve share one session mode, so a `current_mode_update` saying `normal` is not evidence the person left Auto-approve. `ReasonixSessionConfigState.adoptCurrentMode` keeps them where they are; only Plan moves the toolbar on its own. `goal` — keep advancing the prompt until complete or blocked — is Reasonix's own and reads as Safe, because Grimoire has no fourth position.
- The model goes through `session/set_config_option` with `configId: 'model'`. `session/set_model` is answered too; the config option is used because it reports back what the session now holds.
- **Permission requests describe themselves, and `_meta` names the tool, not `kind`.** Three of the four probed shapes arrive as `kind: "other"`, so switching on the kind recognises almost nothing. `_meta["reasonix.io"].tool` is what tells them apart: `write_file` (also `kind: "edit"`, with `rawInput {path, content}`), `exit_plan_mode` (title and tool both, nothing else on it), a shell command (`rawInput.command`), and the `ask` tool, which carries no `_meta` at all and puts the whole question in both `title` and `rawInput.question`. Nothing is remembered between updates, which is the difference from Devin.
- **Safe mode ceiling.** `tool_approval: ask` gates the tools Reasonix classifies as permission-gated, not every tool: a `bash` call running `ls -a` completed unasked in the same turn a `write_file` raised a request (observed 2026-09-09). What makes Safe safe is the same thing that makes it safe for every managed-ACP provider — a vault write travels through the client's `fs/write_text_file`, where `AcpWorkspaceFileSystem` asks the tab. The upgrade path for shell commands is ACP terminal delegation, which no provider drives yet; see `modes.ts`.
- **The tokens are not on the standard channel.** Reasonix sends no `usage_update` at all. `ReasonixSessionNotifications` parses `_reasonix.io/session/status_update` into one, carrying the turn's counts under `_meta` and `size: 0`, because the status states no context-window size. Since no window is ever stated, the badge is drawn against `DEFAULT_CONTEXT_WINDOW` in the chat UI config, and a person whose model differs sets a custom context limit.
- **A charge is forwarded once, at `event: "completion"`.** `usage.turn` is a running figure re-sent whole on every status — three or nine times a turn — and the spend store adds what it is given, so forwarding each one would multiply a single turn's cost. Tokens are a replacement and may arrive at any status; a charge is an addition and arrives once. An unpriced turn contributes nothing rather than a zero; the recorded provider prices nothing and says so as `costQuote.incompleteReason: "no_price"`.
- Plan mode emits ACP `plan` updates and asks to leave Plan mode through the permission channel. Nothing is written outside the vault, so there is no plans-directory door of the kind Devin needs.
- What Reasonix has and this provider does not drive yet, each declared absent in `ReasonixProviderModule`: the `effort` config option (`auto`, `enabled`, `disabled`) is a thinking switch rather than the tiered budget `reasoningControl` models; `_reasonix.io/session/steer` would queue guidance mid-turn; `.reasonix/commands/*.md` are slash commands the CLI reads and the commands surface here does not manage. Reasonix's `ask` tool arrives on the permission channel too, as a request whose `rawInput` carries `question`, `options` and `multi`, and whose answers are N `allow_once` options plus one `reject_once`. It is drawn as an approval rather than through the shared inline question UI Qwen uses: the question becomes the card's description, and each answer is its own numbered option. Because several options share the `allow` presentation, `InlinePermissionRequest` refuses the `Enter` and `a` shortcuts on such a card — a shortcut must not pick one answer out of four.
- Auxiliary workflows such as title generation, instruction refinement, and inline edit are unsupported until a Reasonix auxiliary runner exists.
- Plan indicators are spend-only. `ReasonixPlanUsageStore` records ACP cost when the CLI reports one; account quota is not inferred.

## Boundaries

- Keep Reasonix-specific runtime behavior in `src/providers/reasonix/`.
- Keep protocol-generic JSON-RPC behavior in `src/providers/acp/`.
- Grimoire-owned MCP servers live in `.grimoire/mcp/reasonix.json` and are injected into ACP session creation and loading. Reasonix's own `[[mcp]]` blocks in either config file are read by the CLI and never touched. The recorded handshake advertises `mcpCapabilities: { http: true, sse: false }`.
- Reasonix project skills use `.reasonix/skills/*/SKILL.md`; the CLI also scans `.agents/skills`, `.agent/skills` and `.claude/skills`, and `~/.reasonix/skills` globally.
- Authentication is `reasonix setup`, an interactive wizard that writes a project `reasonix.toml` and a `.env` beside it. API keys are named by `api_key_env` and read from the environment; they stay Reasonix-owned.
- Prefer live ACP wire traces over guessed event shapes when expanding support.

## Launch

```bash
reasonix acp
```

Nothing is forced into the environment. Devin's launcher sets `RUST_LOG=warn` because that CLI traces every dispatch to stderr; Reasonix is a Go binary that writes only warnings there. Custom CLI paths are stored per host under `providerConfigs.reasonix.cliPathsByHost`; otherwise `reasonix` is resolved from PATH, then `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`.

## Session resume

- `session/load` replays the transcript as `user_message_chunk` and the rest before answering with the same models, modes and config options `session/new` gives. Grimoire keeps its own projection and does not read the replay back.
- A missing session answers `-32602 "session/load: unknown session <id>"`, and `session/list` is answered too, so both halves of `isAcpSessionGone` are available. A dropped session is recorded in `providerState.sessionDropped` and read back on load.
