import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  registerAgent,
  getAvailableAgents,
  getAllAgents,
  createTask,
  assignTaskToAgent,
  getAgentByName,
  getTaskForAgent,
  updateTaskStatus,
  completeTask,
  getTask,
  getAllTasks,
  getAgentTasks,
  removeAgent,
  clearState,
  waitForTask,
  triggerHalt,
  isHalted,
  clearHalt,
  getHaltStatus,
} from "./state.js";

const STATE_FILE = path.join(process.cwd(), ".octostrator-state.json");
const LOCK_FILE = `${STATE_FILE}.lock`;

function cleanupFiles(): void {
  try {
    fs.rmSync(LOCK_FILE, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
}

describe("State Management", () => {
  beforeEach(() => {
    cleanupFiles();
    clearState();
  });

  afterEach(() => {
    cleanupFiles();
  });

  describe("Agent Management", () => {
    it("should register a new agent with idle status", () => {
      const agent = registerAgent();

      expect(agent.id).toBeDefined();
      expect(agent.name).toBeNull();
      expect(agent.status).toBe("idle");
      expect(agent.currentTaskId).toBeNull();
      expect(agent.enlistedAt).toBeDefined();
    });

    it("should register multiple agents", () => {
      const agent1 = registerAgent();
      const agent2 = registerAgent();

      expect(agent1.id).not.toBe(agent2.id);

      const allAgents = getAllAgents();
      expect(allAgents).toHaveLength(2);
    });

    it("should get available (idle) agents only", () => {
      const agent1 = registerAgent();
      const agent2 = registerAgent();

      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent1.id, "Agent-1");

      const available = getAvailableAgents();
      expect(available).toHaveLength(1);
      expect(available[0].id).toBe(agent2.id);
    });

    it("should get agent by name", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "TestAgent");

      const found = getAgentByName("TestAgent");
      expect(found).not.toBeNull();
      expect(found?.id).toBe(agent.id);
      expect(found?.name).toBe("TestAgent");
    });

    it("should return null for non-existent agent name", () => {
      const found = getAgentByName("NonExistent");
      expect(found).toBeNull();
    });

    it("should remove an agent", () => {
      const agent = registerAgent();
      expect(getAllAgents()).toHaveLength(1);

      const removed = removeAgent(agent.id);
      expect(removed).toBe(true);
      expect(getAllAgents()).toHaveLength(0);
    });

    it("should return false when removing non-existent agent", () => {
      const removed = removeAgent("non-existent-id");
      expect(removed).toBe(false);
    });
  });

  describe("Task Management", () => {
    it("should create a new task with pending status", () => {
      const task = createTask("Test prompt");

      expect(task.id).toBeDefined();
      expect(task.prompt).toBe("Test prompt");
      expect(task.status).toBe("pending");
      expect(task.agentId).toBeNull();
      expect(task.updates).toEqual([]);
      expect(task.result).toBeNull();
      expect(task.createdAt).toBeDefined();
      expect(task.completedAt).toBeNull();
    });

    it("should get task by id", () => {
      const task = createTask("Test prompt");
      const found = getTask(task.id);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(task.id);
    });

    it("should return null for non-existent task", () => {
      const found = getTask("non-existent-id");
      expect(found).toBeNull();
    });

    it("should get all tasks", () => {
      createTask("Task 1");
      createTask("Task 2");
      createTask("Task 3");

      const tasks = getAllTasks();
      expect(tasks).toHaveLength(3);
    });
  });

  describe("Task Assignment", () => {
    it("should assign task to agent", () => {
      const agent = registerAgent();
      const task = createTask("Test task");

      const success = assignTaskToAgent(task.id, agent.id, "Worker-1");
      expect(success).toBe(true);

      const updatedAgent = getAllAgents().find((a) => a.id === agent.id);
      expect(updatedAgent?.status).toBe("busy");
      expect(updatedAgent?.currentTaskId).toBe(task.id);
      expect(updatedAgent?.name).toBe("Worker-1");

      const updatedTask = getTask(task.id);
      expect(updatedTask?.status).toBe("in_progress");
      expect(updatedTask?.agentId).toBe(agent.id);
    });

    it("should fail to assign task to non-existent agent", () => {
      const task = createTask("Test task");
      const success = assignTaskToAgent(task.id, "non-existent", "Worker");
      expect(success).toBe(false);
    });

    it("should fail to assign non-existent task", () => {
      const agent = registerAgent();
      const success = assignTaskToAgent("non-existent", agent.id, "Worker");
      expect(success).toBe(false);
    });

    it("should fail to assign task to busy agent", () => {
      const agent = registerAgent();
      const task1 = createTask("Task 1");
      const task2 = createTask("Task 2");

      assignTaskToAgent(task1.id, agent.id, "Worker");
      const success = assignTaskToAgent(task2.id, agent.id, "Worker");
      expect(success).toBe(false);
    });

    it("should get task for agent", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");

      const agentTask = getTaskForAgent(agent.id);
      expect(agentTask).not.toBeNull();
      expect(agentTask?.id).toBe(task.id);
    });

    it("should return null when agent has no task", () => {
      const agent = registerAgent();
      const agentTask = getTaskForAgent(agent.id);
      expect(agentTask).toBeNull();
    });

    it("should get tasks for specific agent", () => {
      const agent1 = registerAgent();
      const agent2 = registerAgent();

      const task1 = createTask("Task 1");
      const task2 = createTask("Task 2");
      const task3 = createTask("Task 3");

      assignTaskToAgent(task1.id, agent1.id, "Agent-1");
      completeTask(task1.id, "Done");

      assignTaskToAgent(task2.id, agent1.id, "Agent-1");
      assignTaskToAgent(task3.id, agent2.id, "Agent-2");

      const agent1Tasks = getAgentTasks(agent1.id);
      expect(agent1Tasks).toHaveLength(2);
    });
  });

  describe("Status Updates", () => {
    it("should update task status", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");

      const success = updateTaskStatus(task.id, "Working on it...");
      expect(success).toBe(true);

      const updatedTask = getTask(task.id);
      expect(updatedTask?.updates).toHaveLength(1);
      expect(updatedTask?.updates[0].message).toBe("Working on it...");
      expect(updatedTask?.updates[0].timestamp).toBeDefined();
    });

    it("should add multiple status updates", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");

      updateTaskStatus(task.id, "Step 1 complete");
      updateTaskStatus(task.id, "Step 2 complete");
      updateTaskStatus(task.id, "Almost done");

      const updatedTask = getTask(task.id);
      expect(updatedTask?.updates).toHaveLength(3);
    });

    it("should fail to update status of non-existent task", () => {
      const success = updateTaskStatus("non-existent", "Update");
      expect(success).toBe(false);
    });

    it("should fail to update status of pending task", () => {
      const task = createTask("Test task");
      const success = updateTaskStatus(task.id, "Update");
      expect(success).toBe(false);
    });

    it("should fail to update status of completed task", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");
      completeTask(task.id, "Done");

      const success = updateTaskStatus(task.id, "Update");
      expect(success).toBe(false);
    });
  });

  describe("Task Completion", () => {
    it("should complete a task", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");

      const success = completeTask(task.id, "Task result");
      expect(success).toBe(true);

      const completedTask = getTask(task.id);
      expect(completedTask?.status).toBe("completed");
      expect(completedTask?.result).toBe("Task result");
      expect(completedTask?.completedAt).toBeDefined();

      const updatedAgent = getAllAgents().find((a) => a.id === agent.id);
      expect(updatedAgent?.status).toBe("idle");
      expect(updatedAgent?.currentTaskId).toBeNull();
    });

    it("should fail to complete non-existent task", () => {
      const success = completeTask("non-existent", "Result");
      expect(success).toBe(false);
    });

    it("should fail to complete pending task", () => {
      const task = createTask("Test task");
      const success = completeTask(task.id, "Result");
      expect(success).toBe(false);
    });

    it("should fail to complete already completed task", () => {
      const agent = registerAgent();
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");
      completeTask(task.id, "First result");

      const success = completeTask(task.id, "Second result");
      expect(success).toBe(false);
    });
  });

  describe("waitForTask", () => {
    it("should return removed when agent is removed", async () => {
      const agent = registerAgent();

      const waitPromise = waitForTask(agent.id);

      await new Promise((resolve) => setTimeout(resolve, 100));
      removeAgent(agent.id);

      const result = await waitPromise;
      expect(result.type).toBe("removed");
    });

    it("should return task when assigned", async () => {
      const agent = registerAgent();

      const waitPromise = waitForTask(agent.id);

      await new Promise((resolve) => setTimeout(resolve, 100));
      const task = createTask("Test task");
      assignTaskToAgent(task.id, agent.id, "Worker");

      const result = await waitPromise;
      expect(result.type).toBe("task");
      if (result.type === "task") {
        expect(result.task.id).toBe(task.id);
      }
    });
  });

  describe("Halt Management", () => {
    it("should trigger halt with reason", () => {
      expect(isHalted()).toBe(false);

      triggerHalt("Test error");

      expect(isHalted()).toBe(true);
      const status = getHaltStatus();
      expect(status.halted).toBe(true);
      expect(status.reason).toBe("Test error");
      expect(status.timestamp).toBeDefined();
    });

    it("should clear halt state", () => {
      triggerHalt("Test error");
      expect(isHalted()).toBe(true);

      clearHalt();

      expect(isHalted()).toBe(false);
      const status = getHaltStatus();
      expect(status.halted).toBe(false);
      expect(status.reason).toBeNull();
    });

    it("should return halted when waitForTask detects halt", async () => {
      const agent = registerAgent();

      const waitPromise = waitForTask(agent.id);

      await new Promise((resolve) => setTimeout(resolve, 100));
      triggerHalt("Emergency shutdown");

      const result = await waitPromise;
      expect(result.type).toBe("halted");
      if (result.type === "halted") {
        expect(result.reason).toBe("Emergency shutdown");
      }
    });
  });

  describe("clearState", () => {
    it("should clear all agents and tasks", () => {
      registerAgent();
      registerAgent();
      createTask("Task 1");
      createTask("Task 2");

      expect(getAllAgents()).toHaveLength(2);
      expect(getAllTasks()).toHaveLength(2);

      clearState();

      expect(getAllAgents()).toHaveLength(0);
      expect(getAllTasks()).toHaveLength(0);
    });
  });
});
