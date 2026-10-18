# Work Inbox v1
**Purpose:** Agents explicitly ask the human in Orca. The human reads and answers in the sidebar Work Inbox, grouped by project and individual agent. Internal coordinator mail remains separate.
**Scope:** Human questions, answers, waiting, acknowledgement, and history. General notices, document management, automatic extraction from terminal prose, and provider permission/login dialogs are outside this version.
**Authority:** `src/main/runtime/work-inbox/work-inbox-store.ts` owns the additive `work_inbox_items` table inside the existing orchestration SQLite database. The renderer and MCP server are clients of that state, not additional writable stores.
**Identity and routing:** `src/main/runtime/work-inbox/work-inbox-service.ts` resolves project and agent metadata from the runtime. Every resume and acknowledgement must belong to the original asking agent. Human answers and cancellation require an authenticated desktop or paired-device UI caller. Local CLI clients cannot act as the human.
**Contract:** `src/shared/work-inbox.ts` defines validation, status, options, revision checks, and request identity. `src/main/runtime/rpc/methods/work-inbox.ts` registers the runtime methods through `src/main/runtime/rpc/methods/index.ts`.
**States:** `open` means awaiting a human; `answered` means the answer is durable; `delivered` means the asking client explicitly acknowledged receipt; `cancelled` never implies permission to continue. Returning from a server handler alone does not prove receipt.
**Agent entry:** `orca inbox ask --question "Which approach should I use?" --options "A,B" --request-id <uuid> --json`. A timeout preserves the question; resume its exact ID with `orca inbox ask --resume <id> --json`. Preserve the original request ID and immutable intent after an uncertain create result.
**MCP entry:** `orca inbox mcp` uses standard input/output, the official MCP SDK, and the agent identity injected by Orca. It exposes `ask_user`, `wait_for_answer`, and `acknowledge_answer`; it exposes no human-answer tool. `src/cli/work-inbox-mcp-tools.ts` owns the tools; `src/cli/handlers/work-inbox-mcp.ts` uses the authenticated runtime client.
**MCP configuration example:** Configure the command that belongs to the newly built Orca, not an older installed executable. Restart the MCP process when replacing an agent session.
```json
{
  "mcpServers": {
    "orca-inbox": {
      "command": "orca",
      "args": ["inbox", "mcp"]
    }
  }
}
```
**Agent instructions:** Ask only questions that require a human decision. Use a fresh UUID for a new immutable question. After an uncertain send, retry the same request ID and arguments. After a pending result, call `wait_for_answer` on the original ID. Read the answer, call `acknowledge_answer`, and continue the task. A timeout or cancellation is not approval.
**UI:** `src/renderer/src/components/work-inbox/WorkInboxSidebarEntry.tsx` and `WorkInboxSheet.tsx` expose the sidebar entry, project/agent filters, open/history views, and answer controls. `use-work-inbox.ts` owns scoped requests and drafts. `work-inbox-answer-draft.ts` preserves retry identity and prevents stale versions from replacing newer state. Styling follows `docs/STYLEGUIDE.md`.
**Persistence and compatibility:** The table definition is in `src/main/runtime/work-inbox/work-inbox-row.ts`; it is additive and created idempotently by `src/main/runtime/orchestration/db/schema/create-tables.ts`. Older peers lack these RPC methods and must report an unsupported feature; never silently send to another runtime. No user-data migration or reset is needed. Deploy the runtime before using the new UI/CLI/MCP tools; keep the database on rollback so pending answers survive.
**Acceptance matrix:** Test projects, fixture repositories, databases, temporary files, and logs are under `E:\3. 商業專案\test\work-inbox`. No real user questions or project data are test fixtures.

| Entry → authority → result | Invariant and cases | Evidence source |
| --- | --- | --- |
| MCP tool → runtime ask → SQLite → waiting agent | One question per immutable request; pending resumes the same ID | `specs/mcp-tools.test.ts`, `specs/rpc.integration.test.ts` in the external test project |
| UI answer → revision transaction → original waiter | First valid answer wins; competing and stale answers conflict | `specs/store.integration.test.ts`, `specs/rpc.integration.test.ts` |
| Agent resume/ack → runtime identity → stored answer | Another agent cannot consume or acknowledge the answer | `specs/rpc.integration.test.ts` |
| CLI → human answer endpoint | Agent cannot impersonate authenticated human UI | `specs/rpc.integration.test.ts` |
| SQLite close/reopen → same pending/answered question | Restart preserves IDs, answers and history | `specs/store.integration.test.ts` |
| Answer retry → same operation and immutable body | Duplicate identical answer is safe; reused ID with changed intent rejects | `specs/store.integration.test.ts` |
| UI → selected runtime/project/agent → correct answer | Preserve drafts and retry payload; reject stale responses and double clicks | External frontend tests and rendered acceptance |
| Built Orca → actual question → human UI → continued agent task | Validate current build, hidden renderer and isolated data; receipt is separate from completion | External end-to-end evidence; pending until actually run |

**Commands:** Use the repository's Node 24 and pnpm 12.8.1. The external test configuration imports the checked-out source; its `node_modules` junction points to this repository. Run `node node_modules/vitest/vitest.mjs run --config "E:\3. 商業專案\test\work-inbox\vitest.config.ts"` from the repository. Run relevant typechecks, changed-file lint, CLI registration checks, and an actual build before reporting completion. Set `ORCA_BACKGROUND_LAUNCH=1` for every launched test app, and use an isolated home/userData under the external test root.
**Known verification boundary:** External tests are manually invoked; adding this document does not install a CI gate. Full application acceptance requires the repository's patched Windows native modules. Missing tools, zero tests, failed assertions, and unrun rendered cases are not passes.
**Change record — 2026-10-18:** First implementation. Initial regression runs caught changed answer content accepted under a reused answer ID, premature delivered status, cross-agent resume, and CLI access to human-answer operations. These are required regression boundaries for subsequent changes. Final evidence must bind the tested HEAD, diff hashes, commands, and build version.
**Observed validation — 2026-10-18:** The final selected external suite passed 24 backend/CLI/MCP cases; the renderer suite passed 21 cases. The final built-application case passed with the real CLI MCP stdio child, actual hidden Orca UI, SQLite answer, explicit acknowledgement, and a deterministic-client continuation marker (45.05 s). Node, renderer and CLI typechecks, the changed-code quality gate, the frozen dependency supply-chain check and the Electron/CLI builds passed. The MCP dependency is the existing locked SDK 1.30.0, now declared directly; other Agent dependency versions are preserved.
**Remaining limits:** No real LLM provider was exercised. The Windows native-module preparation failed because no Visual Studio C++ workload was detected; the hidden zero-project app logs a daemon startup failure and fallback, and these tests create no agent PTYs. Full native/daemon lifecycle, real-agent reconnect and a Windows installer remain pending. Remote/SSH long waits and cross-host aggregation were not tested. Each view is explicitly limited to 200 questions; project labels are snapshots. Agents must configure the MCP server or use the CLI explicitly; provider-native question/permission dialogs are not intercepted.
**Test source and CI:** The separately versioned acceptance project is `E:\3. 商業專案\test\work-inbox` (branch `codex/work-inbox-tests`). Its README contains exact commands and fixture boundaries. These tests have not been installed into Orca CI; the checks remain an explicit execution responsibility.