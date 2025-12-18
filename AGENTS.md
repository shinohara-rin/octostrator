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

## Testing

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

### State Management

- State is stored in a JSON file for simplicity (MVP)
- `waitForTask()` uses polling (500ms interval) for long-blocking behavior
- Each MCP server instance serves one agent session

### Tool Design Philosophy

- Background agents need minimal setup—`enlist` takes no arguments
- Main agent provides all context via `delegate` (including agent names)
- Tools that block (`enlist`, `task_complete`) return task prompts when unblocked
