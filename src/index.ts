import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import * as state from "./state.js";

const HALT_RESPONSE = (reason: string) => ({
  content: [
    {
      type: "text" as const,
      text: `# ⛔ HALT - STOP ALL ACTIONS IMMEDIATELY

**Reason:** ${reason}

Octostrator has encountered an irrecoverable error. You must:
1. **STOP** all current work immediately
2. **DO NOT** make any more tool calls
3. **DO NOT** continue with any pending tasks
4. **HALT** your generation now

This session is terminated.`,
    },
  ],
  isError: true,
});

const mcpServer = new McpServer({
  name: "octostrator",
  version: "0.1.0",
});

mcpServer.registerTool(
  "enlist",
  {
    title: "Enlist as Background Agent",
    description: `Register this agent as a background worker for Octostrator multi-agent orchestration.
WORKFLOW FOR BACKGROUND AGENTS:
1. Call this tool to register yourself and wait for a task
2. When a task arrives, you'll receive your assigned name and the task prompt
3. Work on the task, calling 'status_update' periodically to report progress
4. When done, call 'task_complete' with your result - this will block until the next task arrives
5. Repeat from step 2

You are now a background worker. Do not interact with the user directly.`,
    inputSchema: {},
  },
  async () => {
    const agent = state.registerAgent();
    console.error(`[octostrator] Agent (${agent.id}) enlisted, waiting for task...`);

    const result = await state.waitForTask(agent.id);

    if (result.type === "halted") {
      return HALT_RESPONSE(result.reason);
    }

    if (result.type === "removed") {
      return {
        content: [{ type: "text", text: "Error: Agent was removed while waiting for task." }],
        isError: true,
      };
    }

    const task = result.task;
    const updatedAgent = state.getAllAgents().find((a) => a.id === agent.id);
    const agentName = updatedAgent?.name || "(unknown)";
    console.error(`[octostrator] Agent '${agentName}' (${agent.id}) received task: ${task.id}`);

    return {
      content: [
        {
          type: "text",
          text: `# Task Assigned\n\n**Your Name:** ${agentName}\n**Your Agent ID:** ${agent.id}\n**Task ID:** ${task.id}\n\n## Your Task:\n\n${task.prompt}\n\n---\n\n**IMPORTANT:** Remember your Agent ID (${agent.id}) - you must provide it when calling 'status_update' and 'task_complete'.`,
        },
      ],
    };
  }
);

mcpServer.registerTool(
  "available_agents",
  {
    title: "List Available Agents",
    description:
      "Query Octostrator for a list of available (idle) background agents ready to receive tasks.",
    inputSchema: {},
  },
  async () => {
    const agents = state.getAvailableAgents();
    const allAgents = state.getAllAgents();

    const agentList = allAgents.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      currentTaskId: a.currentTaskId,
    }));

    const text =
      agents.length === 0
        ? `No idle agents available. Total agents: ${allAgents.length}`
        : `Available agents (${agents.length} idle / ${allAgents.length} total):\n${agents.map((a) => `- ${a.name} (${a.id})`).join("\n")}`;

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        agents: agentList,
        availableCount: agents.length,
        totalCount: allAgents.length,
      },
    };
  }
);

mcpServer.registerTool(
  "delegate",
  {
    title: "Delegate Task",
    description: `Delegate a task to an available background agent.

The task prompt will be sent to an idle agent. If no agents are available, this will fail.
Use 'available_agents' first to check if agents are ready.`,
    inputSchema: {
      prompt: z.string().describe("The task prompt/instructions for the background agent"),
      agentName: z
        .string()
        .describe(
          "A friendly name for the agent receiving this task (e.g., 'Code-Reviewer', 'Test-Writer')"
        ),
      agentId: z
        .string()
        .optional()
        .describe(
          "Optional: specific agent ID to assign to. If not provided, picks any idle agent."
        ),
    },
  },
  async ({
    prompt,
    agentName,
    agentId,
  }: {
    prompt: string;
    agentName: string;
    agentId?: string;
  }) => {
    const availableAgents = state.getAvailableAgents();

    if (availableAgents.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No available agents. Wait for agents to enlist or complete their tasks.",
          },
        ],
        isError: true,
      };
    }

    const existingAgent = state.getAgentByName(agentName);
    if (existingAgent) {
      return {
        content: [
          {
            type: "text",
            text: `Error: Agent name '${agentName}' is already in use by agent '${existingAgent.id}'. Please choose a unique name to avoid ambiguity.`,
          },
        ],
        isError: true,
      };
    }

    let targetAgent: state.Agent | undefined;
    if (agentId) {
      targetAgent = availableAgents.find((a) => a.id === agentId);
      if (!targetAgent) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Agent '${agentId}' is not available. Use 'available_agents' to see idle agents.`,
            },
          ],
          isError: true,
        };
      }
    } else {
      targetAgent = availableAgents[0];
    }

    const task = state.createTask(prompt);
    const success = state.assignTaskToAgent(task.id, targetAgent.id, agentName);

    if (!success) {
      return {
        content: [
          { type: "text", text: "Error: Failed to assign task. Agent may have become busy." },
        ],
        isError: true,
      };
    }

    console.error(
      `[octostrator] Task ${task.id} delegated to agent '${agentName}' (${targetAgent.id})`
    );

    return {
      content: [
        {
          type: "text",
          text: `Task delegated successfully!\n\n**Task ID:** ${task.id}\n**Assigned to:** ${agentName} (${targetAgent.id})\n\nUse 'status_query' to monitor progress.`,
        },
      ],
      structuredContent: { taskId: task.id, agentId: targetAgent.id, agentName },
    };
  }
);

mcpServer.registerTool(
  "status_update",
  {
    title: "Update Task Status",
    description: `Report progress on your current task. Call this periodically while working.

You MUST provide your agentId (received when you were assigned a task).

Include useful information like:
- What you've accomplished so far
- Current step you're working on
- Any blockers or issues
- Estimated progress percentage`,
    inputSchema: {
      agentId: z.string().describe("Your agent ID (received when task was assigned)"),
      message: z.string().describe("Status update message describing current progress"),
    },
  },
  async ({ agentId, message }: { agentId: string; message: string }) => {
    const agent = state.getAllAgents().find((a) => a.id === agentId);

    if (!agent) {
      return {
        content: [{ type: "text", text: `Error: Agent '${agentId}' not found.` }],
        isError: true,
      };
    }

    if (!agent.currentTaskId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No active task found for this agent. Are you sure you have a task assigned?",
          },
        ],
        isError: true,
      };
    }

    const success = state.updateTaskStatus(agent.currentTaskId, message);

    if (!success) {
      return {
        content: [{ type: "text", text: "Error: Failed to update task status." }],
        isError: true,
      };
    }

    console.error(
      `[octostrator] Status update for task ${agent.currentTaskId}: ${message.substring(0, 50)}...`
    );

    return {
      content: [{ type: "text", text: `Status updated for task ${agent.currentTaskId}.` }],
    };
  }
);

mcpServer.registerTool(
  "status_query",
  {
    title: "Query Agent Status",
    description: `Query the status of a specific agent by name.

Returns the agent's current task, progress updates, and result if completed.`,
    inputSchema: {
      agentName: z.string().describe("The name of the agent to query"),
    },
  },
  async ({ agentName }: { agentName: string }) => {
    const agent = state.getAgentByName(agentName);
    if (!agent) {
      return {
        content: [{ type: "text", text: `Error: Agent '${agentName}' not found.` }],
        isError: true,
      };
    }

    const tasks = state.getAgentTasks(agent.id);
    const currentTask = agent.currentTaskId ? state.getTask(agent.currentTaskId) : null;
    const completedTasks = tasks.filter((t) => t.status === "completed");

    let text = `# Agent: ${agent.name}

**Status:** ${agent.status}
**Agent ID:** ${agent.id}
**Enlisted:** ${new Date(agent.enlistedAt).toLocaleString()}
`;

    if (currentTask) {
      const updates = currentTask.updates
        .map((u) => `[${new Date(u.timestamp).toLocaleTimeString()}] ${u.message}`)
        .join("\n");
      text += `
## Current Task: ${currentTask.id}

### Prompt:
${currentTask.prompt}

### Progress Updates:
${updates || "(No updates yet)"}
`;
      if (currentTask.result) {
        text += `\n### Result:\n${currentTask.result}`;
      }
    } else {
      text += `\n## Current Task: None (idle)`;
    }

    if (completedTasks.length > 0) {
      text += `\n\n## Completed Tasks (${completedTasks.length}):\n`;
      text += completedTasks
        .map((t) => `- **${t.id}**: ${t.result?.substring(0, 100)}...`)
        .join("\n");
    }

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        agent: { ...agent },
        currentTask: currentTask ? { ...currentTask } : null,
        completedTasks,
      },
    };
  }
);

mcpServer.registerTool(
  "status_query_all",
  {
    title: "Query All Status",
    description: `Query the status of all agents and tasks.

Returns:
- List of all agents and their current status
- List of all tasks with their progress updates
- Completed task results`,
    inputSchema: {},
  },
  async () => {
    const agents = state.getAllAgents();
    const tasks = state.getAllTasks();

    const agentSummary =
      agents.length === 0
        ? "(No agents)"
        : agents
            .map(
              (a) =>
                `- **${a.name || "(unnamed)"}** (${a.id}): ${a.status}${a.currentTaskId ? ` - working on ${a.currentTaskId}` : ""}`
            )
            .join("\n");

    const taskSummary =
      tasks.length === 0
        ? "(No tasks)"
        : tasks
            .map((t) => {
              const latestUpdate =
                t.updates.length > 0 ? t.updates[t.updates.length - 1].message : null;
              return `- **${t.id}**: ${t.status}${latestUpdate ? ` - "${latestUpdate.substring(0, 50)}..."` : ""}`;
            })
            .join("\n");

    const text = `# Octostrator Status

## Agents (${agents.filter((a) => a.status === "idle").length} idle / ${agents.length} total)
${agentSummary}

## Tasks (${tasks.filter((t) => t.status === "in_progress").length} in progress, ${tasks.filter((t) => t.status === "completed").length} completed)
${taskSummary}`;

    return {
      content: [{ type: "text", text }],
      structuredContent: { agents, tasks },
    };
  }
);

mcpServer.registerTool(
  "task_complete",
  {
    title: "Complete Task",
    description: `Mark your current task as complete and submit the result.

You MUST provide your agentId (received when you were assigned a task).

After submitting, this tool will BLOCK and wait for your next task assignment.
When a new task arrives, you'll receive the task prompt as the return value.

Continue the work loop until you're told to stop.`,
    inputSchema: {
      agentId: z.string().describe("Your agent ID (received when task was assigned)"),
      result: z
        .string()
        .describe("The result/output of your completed task. Include all relevant information."),
    },
  },
  async ({ agentId, result }: { agentId: string; result: string }) => {
    const agent = state.getAllAgents().find((a) => a.id === agentId);

    if (!agent) {
      return {
        content: [{ type: "text", text: `Error: Agent '${agentId}' not found.` }],
        isError: true,
      };
    }

    if (!agent.currentTaskId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: No active task found. Are you sure you have a task assigned?",
          },
        ],
        isError: true,
      };
    }

    const taskId = agent.currentTaskId;
    const success = state.completeTask(taskId, result);

    if (!success) {
      return {
        content: [{ type: "text", text: "Error: Failed to complete task." }],
        isError: true,
      };
    }

    console.error(
      `[octostrator] Task ${taskId} completed by agent '${agent.name}'. Waiting for next task...`
    );

    const waitResult = await state.waitForTask(agent.id);

    if (waitResult.type === "halted") {
      return HALT_RESPONSE(waitResult.reason);
    }

    if (waitResult.type === "removed") {
      return {
        content: [
          { type: "text", text: "Task completed. Agent was removed while waiting for next task." },
        ],
        isError: true,
      };
    }

    const nextTask = waitResult.task;
    console.error(`[octostrator] Agent '${agent.name}' received new task: ${nextTask.id}`);

    return {
      content: [
        {
          type: "text",
          text: `# Task Completed & New Task Assigned\n\n**Previous Task:** ${taskId} ✓\n**Your Agent ID:** ${agent.id}\n**New Task ID:** ${nextTask.id}\n\n## Your New Task:\n\n${nextTask.prompt}\n\n---\n\n**IMPORTANT:** Remember your Agent ID (${agent.id}) - you must provide it when calling 'status_update' and 'task_complete'.`,
        },
      ],
    };
  }
);

mcpServer.registerTool(
  "halt",
  {
    title: "Halt All Agents",
    description: `Trigger an emergency halt for all Octostrator agents.

Use this when:
- An irrecoverable error has occurred
- You need to stop all background agents immediately
- The orchestration needs to be terminated

All waiting agents will receive a HALT signal and stop their work.`,
    inputSchema: {
      reason: z.string().describe("The reason for halting all agents"),
    },
  },
  async ({ reason }: { reason: string }) => {
    state.triggerHalt(reason);

    return {
      content: [
        {
          type: "text",
          text: `# ⛔ HALT Triggered

**Reason:** ${reason}

All background agents have been signaled to stop. Any agents waiting for tasks will receive the halt signal and terminate their work.`,
        },
      ],
    };
  }
);

mcpServer.registerTool(
  "clear_halt",
  {
    title: "Clear Halt State",
    description: `Clear the halt state to allow agents to resume operations.

Use this after resolving the issue that caused the halt.`,
    inputSchema: {},
  },
  async () => {
    state.clearHalt();

    return {
      content: [
        {
          type: "text",
          text: "Halt state cleared. Agents can now resume normal operations.",
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[octostrator] MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
