import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(process.cwd(), ".octostrator-state.json");
const POLL_INTERVAL_MS = 500;

export interface Agent {
  id: string;
  name: string | null;
  status: "idle" | "busy";
  currentTaskId: string | null;
  enlistedAt: number;
}

export interface StatusUpdate {
  timestamp: number;
  message: string;
}

export interface Task {
  id: string;
  agentId: string | null;
  prompt: string;
  status: "pending" | "in_progress" | "completed";
  updates: StatusUpdate[];
  result: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface State {
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
}

function readState(): State {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error reading state file:", error);
  }
  return { agents: {}, tasks: {} };
}

function writeState(state: State): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function registerAgent(): Agent {
  const state = readState();
  const id = generateId();
  const agent: Agent = {
    id,
    name: null,
    status: "idle",
    currentTaskId: null,
    enlistedAt: Date.now(),
  };
  state.agents[id] = agent;
  writeState(state);
  return agent;
}

export function getAvailableAgents(): Agent[] {
  const state = readState();
  return Object.values(state.agents).filter((a) => a.status === "idle");
}

export function getAllAgents(): Agent[] {
  const state = readState();
  return Object.values(state.agents);
}

export function createTask(prompt: string): Task {
  const state = readState();
  const id = generateId();
  const task: Task = {
    id,
    agentId: null,
    prompt,
    status: "pending",
    updates: [],
    result: null,
    createdAt: Date.now(),
    completedAt: null,
  };
  state.tasks[id] = task;
  writeState(state);
  return task;
}

export function assignTaskToAgent(taskId: string, agentId: string, agentName: string): boolean {
  const state = readState();
  const task = state.tasks[taskId];
  const agent = state.agents[agentId];

  if (!task || !agent || agent.status !== "idle") {
    return false;
  }

  task.agentId = agentId;
  task.status = "in_progress";
  agent.status = "busy";
  agent.currentTaskId = taskId;
  agent.name = agentName;

  writeState(state);
  return true;
}

export function getAgentByName(name: string): Agent | null {
  const state = readState();
  return Object.values(state.agents).find((a) => a.name === name) || null;
}

export function getTaskForAgent(agentId: string): Task | null {
  const state = readState();
  const agent = state.agents[agentId];
  if (!agent || !agent.currentTaskId) {
    return null;
  }
  return state.tasks[agent.currentTaskId] || null;
}

export function updateTaskStatus(taskId: string, message: string): boolean {
  const state = readState();
  const task = state.tasks[taskId];
  if (!task || task.status !== "in_progress") {
    return false;
  }

  task.updates.push({
    timestamp: Date.now(),
    message,
  });

  writeState(state);
  return true;
}

export function completeTask(taskId: string, result: string): boolean {
  const state = readState();
  const task = state.tasks[taskId];
  if (!task || task.status !== "in_progress") {
    return false;
  }

  task.status = "completed";
  task.result = result;
  task.completedAt = Date.now();

  if (task.agentId) {
    const agent = state.agents[task.agentId];
    if (agent) {
      agent.status = "idle";
      agent.currentTaskId = null;
    }
  }

  writeState(state);
  return true;
}

export function getTask(taskId: string): Task | null {
  const state = readState();
  return state.tasks[taskId] || null;
}

export function getAllTasks(): Task[] {
  const state = readState();
  return Object.values(state.tasks);
}

export function getAgentTasks(agentId: string): Task[] {
  const state = readState();
  return Object.values(state.tasks).filter((t) => t.agentId === agentId);
}

export async function waitForTask(agentId: string): Promise<Task | null> {
  while (true) {
    const state = readState();
    const agent = state.agents[agentId];

    if (!agent) {
      return null;
    }

    if (agent.status === "busy" && agent.currentTaskId) {
      const task = state.tasks[agent.currentTaskId];
      if (task && task.status === "in_progress") {
        return task;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function removeAgent(agentId: string): boolean {
  const state = readState();
  if (!state.agents[agentId]) {
    return false;
  }
  delete state.agents[agentId];
  writeState(state);
  return true;
}

export function clearState(): void {
  writeState({ agents: {}, tasks: {} });
}
