import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import * as fs from "fs";
import * as path from "path";
import * as state from "./state.js";

const STATE_FILE = path.join(process.cwd(), ".octostrator-state.json");

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

function getResultText(result: unknown): string {
  const r = result as ToolResult;
  return (r.content[0] as { text: string }).text;
}

function getResult(result: unknown): ToolResult {
  return result as ToolResult;
}

function createTestServer(): McpServer {
  const mcpServer = new McpServer({
    name: "octostrator-test",
    version: "0.1.0",
  });

  mcpServer.registerTool(
    "available_agents",
    {
      title: "List Available Agents",
      description: "Query Octostrator for a list of available (idle) background agents.",
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
      description: "Delegate a task to an available background agent.",
      inputSchema: {
        prompt: z.string().describe("The task prompt"),
        agentName: z.string().describe("Name for the agent"),
        agentId: z.string().optional().describe("Optional agent ID"),
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
              text: "Error: No available agents.",
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
              text: `Error: Agent name '${agentName}' is already in use by agent '${existingAgent.id}'.`,
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
                text: `Error: Agent '${agentId}' is not available.`,
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
          content: [{ type: "text", text: "Error: Failed to assign task." }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Task delegated successfully!\n\n**Task ID:** ${task.id}\n**Assigned to:** ${agentName}`,
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
      description: "Report progress on current task.",
      inputSchema: {
        agentId: z.string().describe("Your agent ID"),
        message: z.string().describe("Status message"),
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
          content: [{ type: "text", text: "Error: No active task found." }],
          isError: true,
        };
      }

      const success = state.updateTaskStatus(agent.currentTaskId, message);

      if (!success) {
        return {
          content: [{ type: "text", text: "Error: Failed to update status." }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: `Status updated for task ${agent.currentTaskId}.` }],
      };
    }
  );

  mcpServer.registerTool(
    "status_query",
    {
      title: "Query Agent Status",
      description: "Query status of a specific agent by name.",
      inputSchema: {
        agentName: z.string().describe("Agent name to query"),
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

      const currentTask = agent.currentTaskId ? state.getTask(agent.currentTaskId) : null;

      return {
        content: [{ type: "text", text: `Agent: ${agent.name}, Status: ${agent.status}` }],
        structuredContent: {
          agent: { ...agent },
          currentTask: currentTask ? { ...currentTask } : null,
        },
      };
    }
  );

  mcpServer.registerTool(
    "status_query_all",
    {
      title: "Query All Status",
      description: "Query status of all agents and tasks.",
      inputSchema: {},
    },
    async () => {
      const agents = state.getAllAgents();
      const tasks = state.getAllTasks();

      return {
        content: [
          {
            type: "text",
            text: `Agents: ${agents.length}, Tasks: ${tasks.length}`,
          },
        ],
        structuredContent: { agents, tasks },
      };
    }
  );

  return mcpServer;
}

async function createConnectedClient(): Promise<{ client: Client; server: McpServer }> {
  const server = createTestServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server };
}

describe("MCP Tools", () => {
  beforeEach(() => {
    state.clearState();
  });

  afterEach(() => {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
  });

  describe("available_agents", () => {
    it("should return empty list when no agents", async () => {
      const { client } = await createConnectedClient();

      const result = await client.callTool({ name: "available_agents", arguments: {} });

      const r = getResult(result);
      expect(r.content).toBeDefined();
      expect(r.content[0]).toHaveProperty("text");
      expect(getResultText(result)).toContain("No idle agents available");
    });

    it("should list available agents", async () => {
      const agent = state.registerAgent();
      state.registerAgent(); // Second agent stays idle
      const task = state.createTask("Test");
      state.assignTaskToAgent(task.id, agent.id, "TestAgent");

      const { client } = await createConnectedClient();
      const result = await client.callTool({ name: "available_agents", arguments: {} });

      expect(getResult(result).content[0]).toHaveProperty("text");
      expect(getResultText(result)).toContain("1 idle / 2 total");
    });
  });

  describe("delegate", () => {
    it("should fail when no agents available", async () => {
      const { client } = await createConnectedClient();

      const result = await client.callTool({
        name: "delegate",
        arguments: { prompt: "Test task", agentName: "Worker" },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("No available agents");
    });

    it("should delegate task to available agent", async () => {
      state.registerAgent();

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "delegate",
        arguments: { prompt: "Build feature X", agentName: "FeatureBuilder" },
      });

      expect(getResult(result).isError).toBeUndefined();
      expect(getResultText(result)).toContain("Task delegated successfully");
      expect(getResultText(result)).toContain("FeatureBuilder");

      const agent = state.getAgentByName("FeatureBuilder");
      expect(agent).not.toBeNull();
      expect(agent?.status).toBe("busy");
    });

    it("should fail when specified agent is not available", async () => {
      state.registerAgent();

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "delegate",
        arguments: {
          prompt: "Test task",
          agentName: "Worker",
          agentId: "non-existent-id",
        },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("not available");
    });

    it("should fail when agent name is already in use", async () => {
      const agent1 = state.registerAgent();
      state.registerAgent(); // Ensure another agent is available
      const task = state.createTask("Task 1");
      state.assignTaskToAgent(task.id, agent1.id, "ExistingName");

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "delegate",
        arguments: {
          prompt: "Task 2",
          agentName: "ExistingName",
        },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("already in use");
    });
  });

  describe("status_update", () => {
    it("should fail when agent not found", async () => {
      const { client } = await createConnectedClient();

      const result = await client.callTool({
        name: "status_update",
        arguments: { agentId: "non-existent", message: "Progress update" },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("not found");
    });

    it("should fail when no active task", async () => {
      const agent = state.registerAgent();

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "status_update",
        arguments: { agentId: agent.id, message: "Progress update" },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("No active task");
    });

    it("should update task status", async () => {
      const agent = state.registerAgent();
      const task = state.createTask("Test task");
      state.assignTaskToAgent(task.id, agent.id, "Worker");

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "status_update",
        arguments: { agentId: agent.id, message: "50% complete" },
      });

      expect(getResult(result).isError).toBeUndefined();
      expect(getResultText(result)).toContain("Status updated");

      const updatedTask = state.getTask(task.id);
      expect(updatedTask?.updates).toHaveLength(1);
      expect(updatedTask?.updates[0].message).toBe("50% complete");
    });
  });

  describe("status_query", () => {
    it("should fail for non-existent agent", async () => {
      const { client } = await createConnectedClient();

      const result = await client.callTool({
        name: "status_query",
        arguments: { agentName: "NonExistent" },
      });

      expect(getResult(result).isError).toBe(true);
      expect(getResultText(result)).toContain("not found");
    });

    it("should return agent status", async () => {
      const agent = state.registerAgent();
      const task = state.createTask("Test task");
      state.assignTaskToAgent(task.id, agent.id, "QueryTest");

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "status_query",
        arguments: { agentName: "QueryTest" },
      });

      expect(getResult(result).isError).toBeUndefined();
      expect(getResultText(result)).toContain("QueryTest");
      expect(getResultText(result)).toContain("busy");
    });
  });

  describe("status_query_all", () => {
    it("should return all agents and tasks", async () => {
      state.registerAgent();
      state.registerAgent();
      state.createTask("Task 1");
      state.createTask("Task 2");

      const { client } = await createConnectedClient();
      const result = await client.callTool({
        name: "status_query_all",
        arguments: {},
      });

      expect(getResult(result).isError).toBeUndefined();
      expect(getResultText(result)).toContain("Agents: 2");
      expect(getResultText(result)).toContain("Tasks: 2");
    });
  });

  describe("Tool listing", () => {
    it("should list all registered tools", async () => {
      const { client } = await createConnectedClient();

      const tools = await client.listTools();

      expect(tools.tools).toHaveLength(5);
      const toolNames = tools.tools.map((t) => t.name);
      expect(toolNames).toContain("available_agents");
      expect(toolNames).toContain("delegate");
      expect(toolNames).toContain("status_update");
      expect(toolNames).toContain("status_query");
      expect(toolNames).toContain("status_query_all");
    });
  });
});
