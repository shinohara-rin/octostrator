import * as fs from "fs";
import * as path from "path";
import * as lockfile from "proper-lockfile";

const STATE_FILE = path.join(process.cwd(), ".octostrator-state.json");
const POLL_INTERVAL_MS = 500;
const LOCK_OPTIONS_SYNC = { stale: 10000 };

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

export interface HaltInfo {
  halted: boolean;
  reason: string | null;
  timestamp: number | null;
}

export interface State {
  agents: Record<string, Agent>;
  tasks: Record<string, Task>;
  halt: HaltInfo;
}

const DEFAULT_HALT: HaltInfo = { halted: false, reason: null, timestamp: null };

function ensureStateFile(): void {
  try {
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ agents: {}, tasks: {}, halt: DEFAULT_HALT }, null, 2),
      { flag: "wx" }
    );
  } catch {
    // File already exists or other error - ignore, we'll read it
  }
}

function readState(): State {
  try {
    ensureStateFile();
    const data = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading state file:", error);
  }
  return { agents: {}, tasks: {}, halt: DEFAULT_HALT };
}

// Always acquire a lock before writing to the state file
function writeState(state: State): void {
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
}

function withLock<T>(fn: () => T): T {
  ensureStateFile();
  const release = lockfile.lockSync(STATE_FILE, LOCK_OPTIONS_SYNC);
  try {
    return fn();
  } finally {
    release();
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

export function registerAgent(): Agent {
  return withLock(() => {
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
  });
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
  return withLock(() => {
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
  });
}

export function assignTaskToAgent(taskId: string, agentId: string, agentName: string): boolean {
  return withLock(() => {
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
  });
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
  return withLock(() => {
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
  });
}

export function completeTask(taskId: string, result: string): boolean {
  return withLock(() => {
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
  });
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

export type WaitResult =
  | { type: "task"; task: Task }
  | { type: "removed" }
  | { type: "halted"; reason: string };

export async function waitForTask(agentId: string): Promise<WaitResult> {
  while (true) {
    const state = readState();

    if (state.halt?.halted) {
      return { type: "halted", reason: state.halt.reason || "Unknown error" };
    }

    const agent = state.agents[agentId];

    if (!agent) {
      return { type: "removed" };
    }

    if (agent.status === "busy" && agent.currentTaskId) {
      const task = state.tasks[agent.currentTaskId];
      if (task && task.status === "in_progress") {
        return { type: "task", task };
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export function removeAgent(agentId: string): boolean {
  return withLock(() => {
    const state = readState();
    if (!state.agents[agentId]) {
      return false;
    }
    delete state.agents[agentId];
    writeState(state);
    return true;
  });
}

export function clearState(): void {
  withLock(() => {
    writeState({ agents: {}, tasks: {}, halt: DEFAULT_HALT });
  });
}

export function triggerHalt(reason: string): void {
  withLock(() => {
    const state = readState();
    state.halt = {
      halted: true,
      reason,
      timestamp: Date.now(),
    };
    writeState(state);
  });
  console.error(`[octostrator] HALT triggered: ${reason}`);
}

export function getHaltStatus(): HaltInfo {
  const state = readState();
  return state.halt || DEFAULT_HALT;
}

export function clearHalt(): void {
  withLock(() => {
    const state = readState();
    state.halt = DEFAULT_HALT;
    writeState(state);
  });
}

export function isHalted(): boolean {
  const state = readState();
  return state.halt?.halted ?? false;
}
