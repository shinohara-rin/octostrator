# Octostrator

Octostrator is a MCP tool that orchestrates collaborations between agents in agentic IDEs like Windsurf.

Currently Octostrator is in development, and is not ready for production use.

## Advantages

- Efficiency: Multiple agents now work in parallel to complete tasks faster.
- Isolation: Each agent has its own context window, avoiding context overflow and pollution from irrelevant information.
- Empirically validated: Role-based multi-agent collaboration has been validated by empirical studies.

## Features

### Agent orchestration

Create multiple background chat sessions in your IDE and let Octostrator take care of them, saving you the hassle of managing multiple chat sessions.

### Task delegation

Whenever you issue a complex task that can make use of multi-agent collaboration, Octostrator will automatically delegate chunked tasks to background agents.

## Tools

### `enlist`

Register as a background agent. This tool blocks until a task is assigned, then returns the agent's assigned name and task prompt. No input required - the main agent names you when delegating.

### `available_agents`

Query Octostrator for a list of available (idle) background agents ready to receive tasks.

### `delegate`

Delegate a task to an available background agent. Requires a task prompt and an agent name. The agent will receive both when their `enlist` call returns.

### `status_update`

For background agents to report progress on their current task. Call this periodically with useful information about what you've accomplished and what you're working on.

### `status_query`

Query the status of a specific agent by name. Returns the agent's current task, progress updates, and completed task results.

### `status_query_all`

Query the status of all agents and tasks. Returns a summary of all agents (idle/busy) and all tasks (pending/in_progress/completed).

### `task_complete`

Mark the current task as complete and submit the result. This tool blocks until the next task arrives, then returns the new task prompt.

## Future plans

### Conflict resolution

Octostrator manages git worktrees for agents that need to read/write concurrently. This avoids conflicts between agents.

## TODO

- [ ] Create a dedicated CLI tool for monitoring state and performing cleanup operations (e.g. pruning old tasks).
