# Octostrator

An MCP server that orchestrates multi-agent collaboration in agentic IDEs like Windsurf.

## Tech Stack

- **Runtime:** Node.js 20+
- **Language:** TypeScript 5.9+
- **Framework:** MCP SDK (`@modelcontextprotocol/sdk` ^1.25.1)
- **Validation:** Zod 4
- **Package Manager:** pnpm

## Project Structure

```
src/
├── index.ts    # MCP server entry point, tool registrations
└── state.ts    # JSON-based state management (agents, tasks)
```

- **State file:** `.octostrator-state.json` (created at runtime in project root)

## Commands

```bash
# Development
pnpm dev              # Run with tsx (hot reload)

# Build & Run
pnpm build            # Compile TypeScript to dist/
pnpm start            # Run compiled version

# Code Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix lint errors
pnpm format           # Format with Prettier
pnpm format:check     # Check formatting
```

## Code Style

### Naming Conventions

- **Functions/variables:** camelCase (`registerAgent`, `waitForTask`)
- **Interfaces/Types:** PascalCase (`Agent`, `Task`, `StatusUpdate`)
- **Constants:** UPPER_SNAKE_CASE (`POLL_INTERVAL_MS`, `STATE_FILE`)

### Patterns

- Use async/await for all asynchronous operations
- Return structured `{ content, structuredContent }` from MCP tools
- Log to `console.error` (stdout is reserved for MCP protocol)

### Example

```typescript
// ✅ Good - descriptive, proper error handling, typed
export async function waitForTask(agentId: string): Promise<Task | null> {
  while (true) {
    const state = readState();
    const agent = state.agents[agentId];
    if (!agent) return null;
    // ...
  }
}

// ❌ Bad - vague names, no types
async function wait(id) {
  // ...
}
```

### Testing

```bash
pnpm test              # Run tests in watch mode
pnpm test:run          # Run tests once
```

### Test Structure

- **`src/state.test.ts`** - Unit tests for state management (30 tests)
  - Agent registration, removal, querying
  - Task creation, assignment, completion
  - Status updates and polling

- **`src/index.test.ts`** - Integration tests for MCP tools (11 tests)
  - Uses `InMemoryTransport` to simulate client-server interaction
  - Tests tool registration, execution, and error handling

### Writing New Tests

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// Create linked transport pair
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

// Connect client and server
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

// Call tools via client
const result = await client.callTool({ name: "tool_name", arguments: {} });
```

## Debugging & Troubleshooting

### Logs & Output
- **Standard Output (stdout):** RESERVED for MCP protocol messages (JSON-RPC). **NEVER** log to stdout.
- **Standard Error (stderr):** Use `console.error()` for all logging, debugging, and status messages. These will appear in the MCP client's logs.

### State Inspection
- The `.octostrator-state.json` file is the source of truth.
- You can inspect this file at any time to verify the current state of agents and tasks.
- **Warning:** Do not manually edit this file while the server is running to avoid corruption or lock contention.

### Common Issues
- **Stale Locks:** If the server crashes hard, a `.octostrator-state.json.lock` folder might remain. Delete it manually if the server refuses to start or operations time out.
- **"Agent Removed" Error:** This usually happens if the state file was corrupted or reset while an agent was polling. Ensure atomic writes are being used (implemented in `src/state.ts`).

## Known Limitations

- **Unbounded State Growth:** The JSON state file grows indefinitely as tasks are completed. There is currently no auto-pruning mechanism.
- **Scalability:** Designed for single-machine use. The file locking mechanism works across processes but is not suitable for distributed environments.
- **State File Performance:** As the state file grows, parsing it on every read (`readState`) will become slower.

## Git Workflow

- Pre-commit hooks run `lint-staged` (ESLint + Prettier)
- Commit messages should be descriptive
- Keep commits atomic and focused

## Boundaries

- ✅ **Always:** Run `pnpm lint` and `pnpm format` before committing
- ✅ **Always:** Update README.md when adding/changing tools
- ⚠️ **Ask first:** Adding new dependencies, changing MCP protocol behavior
- 🚫 **Never:** Commit `.octostrator-state.json` (runtime state)
- 🚫 **Never:** Hardcode secrets or API keys

## Architecture Notes

### Task Lifecycle

The following state machine describes the lifecycle of a task in Octostrator:

1.  **Creation:** `delegate` creates a task -> `pending`
2.  **Assignment:** `waitForTask` (in background agent) picks up task -> `in_progress`
3.  **Updates:** Agent calls `status_update` -> `in_progress` (with new log entry)
4.  **Completion:** Agent calls `task_complete` -> `completed` (result stored)

### Agent Lifecycle

1.  **Enlistment:** Agent calls `enlist` -> `idle`
2.  **Assignment:** Task assigned -> `busy` (linked to `currentTaskId`)
3.  **Completion:** Agent calls `task_complete` -> `idle` (ready for next task)

### State Management

- **Storage:** JSON file (`.octostrator-state.json`) in project root.
- **Concurrency:**
  - Uses `proper-lockfile` for exclusive access during reads/writes.
  - **Atomic Writes:** Always write to a temporary file (`.tmp`) and rename to ensure readers never see partial files.
  - **Polling:** `waitForTask()` uses polling (500ms interval) with non-locking reads to avoid blocking writers.
- **Error Handling:**
  - **Halt Mechanism:** Global `halt` state triggers emergency shutdown for all agents.
  - **Agent ID:** Agents must store and provide their `agentId` for all stateful operations (`status_update`, `task_complete`).
- **Scope:** Each MCP server instance serves one agent session, but they all share the same state file.

### Tool Design Philosophy

- Background agents need minimal setup—`enlist` takes no arguments
- Main agent provides all context via `delegate` (including agent names)
- Tools that block (`enlist`, `task_complete`) return task prompts when unblocked

## Core Invariants & Protocol Standards

### Invariants
1.  **Unique Agent Names:** The `delegate` tool enforces uniqueness. No two active agents can share the same name.
2.  **Agent ID Continuity:** An agent's ID is its lifetime identity. It must be preserved and presented in all stateful calls (`status_update`, `task_complete`).
3.  **Atomic State Transitions:** All state mutations (`assignTask`, `completeTask`, `updateStatus`) are atomic and locked. Readers never see partial writes.

### Protocol Standards
- **Error Responses:** All tool errors must return `{ content: [...], isError: true }`.
- **Halt Compliance:** If any tool returns a `halted` signal, the agent **MUST** stop all execution immediately.
- **Task Blocking:** Background agents should block on `task_complete` until a new task arrives or a halt signal is received.

## Adding a New Tool

Follow this checklist when adding new capabilities to Octostrator:

1.  **Interface Design:**
    *   Define a clear, descriptive `title` and `description`.
    *   Use `zod` for strict input validation.
    *   **Stateful Tools:** If the tool modifies agent state, it **MUST** require `agentId` as an argument.

2.  **Implementation:**
    *   Use `state.ts` helpers for all data access.
    *   **Locking:** Ensure any state-mutating function in `state.ts` is wrapped in `withLock`.
    *   **Error Handling:** Return `{ content: [...], isError: true }` for logical failures (e.g., "Agent not found").

3.  **Testing:**
    *   Add an integration test in `src/index.test.ts`.
    *   Verify both success and failure paths.

4.  **Documentation:**
    *   Add the tool to the **Tools** section in `README.md`.
