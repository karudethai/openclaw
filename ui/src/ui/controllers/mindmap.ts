import { generateUUID } from "../uuid.ts";
import type { GatewayBrowserClient, GatewayEventFrame } from "../gateway.ts";
import type {
  MindmapGraph,
  MindmapNode,
  MindmapNodeId,
  SessionsListResult,
} from "../types.ts";
import type { AgentEventPayload } from "../app-tool-stream.ts";
import type { ChatEventPayload } from "./chat.ts";
import { extractText } from "../chat/message-extract.ts";

// ── State shape ──────────────────────────────────────────────────────

export type ChatPreviewLine = {
  role: "user" | "assistant";
  text: string;
  isSummary?: boolean;
};

export type MindmapState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  mindmapGraph: MindmapGraph | null;
  mindmapSelectedNodeId: MindmapNodeId | null;
  mindmapEditingNodeId: MindmapNodeId | null;
  mindmapSessionsResult: SessionsListResult | null;
  mindmapChatPreviews: Map<string, ChatPreviewLine[]>;
  settings: { gatewayUrl?: string };
  agentsList?: import("../types.ts").AgentsListResult | null;
};

// ── Storage ──────────────────────────────────────────────────────────

function storageKey(state: MindmapState): string {
  const url = state.settings.gatewayUrl ?? "default";
  return `openclaw-mindmap-${url}`;
}

export function loadMindmap(state: MindmapState): void {
  try {
    const raw = localStorage.getItem(storageKey(state));
    if (raw) {
      state.mindmapGraph = JSON.parse(raw) as MindmapGraph;
    }
  } catch {
    // Ignore corrupt data
  }
}

export function saveMindmap(state: MindmapState): void {
  if (!state.mindmapGraph) {
    return;
  }
  state.mindmapGraph.updatedAt = Date.now();
  try {
    localStorage.setItem(storageKey(state), JSON.stringify(state.mindmapGraph));
  } catch {
    // Storage full or unavailable
  }
}

// ── Graph creation ───────────────────────────────────────────────────

export function createMindmap(state: MindmapState, title: string): void {
  const now = Date.now();
  const rootNode: MindmapNode = {
    id: generateUUID(),
    label: title,
    x: 0,
    y: 0,
    status: "active",
    createdAt: now,
  };
  state.mindmapGraph = {
    id: generateUUID(),
    title,
    nodes: [rootNode],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  state.mindmapSelectedNodeId = null;
  state.mindmapEditingNodeId = null;
  saveMindmap(state);
}

// ── Node mutations ───────────────────────────────────────────────────

const TWO_PI = 2 * Math.PI;

export function applyRadialLayout(graph: MindmapGraph) {
  if (!graph || graph.nodes.length === 0) return;
  const rootId = graph.nodes[0].id;
  
  const childEdges = graph.edges.filter((e) => e.from === rootId);
  const childIds = childEdges.map((e) => e.to);
  const childNodes = graph.nodes.filter((n) => childIds.includes(n.id));

  if (childNodes.length === 0) return;

  const radius = Math.max(350, (childNodes.length * 380) / TWO_PI);
  
  childNodes.forEach((child, index) => {
    const angle = (TWO_PI * index) / Math.max(childNodes.length, 1) - Math.PI / 2;
    child.x = radius * Math.cos(angle);
    child.y = radius * Math.sin(angle);
  });
}

export function addNode(
  state: MindmapState,
  label: string,
  parentId?: MindmapNodeId,
): MindmapNodeId | null {
  const graph = state.mindmapGraph;
  if (!graph) return null;

  const resolvedParentId = parentId ?? graph.nodes[0]?.id;
  const parent = graph.nodes.find((n) => n.id === resolvedParentId);
  if (!parent) return null;

  const now = Date.now();
  const node: MindmapNode = {
    id: generateUUID(),
    label,
    x: 0,
    y: 0,
    parentId: resolvedParentId,
    status: "idle",
    createdAt: now,
  };

  graph.nodes = [...graph.nodes, node];
  graph.edges = [...graph.edges, { from: resolvedParentId, to: node.id }];
  
  applyRadialLayout(graph);
  
  state.mindmapGraph = { ...graph };
  saveMindmap(state);
  return node.id;
}

export function updateNode(
  state: MindmapState,
  nodeId: MindmapNodeId,
  patch: Partial<Pick<MindmapNode, "label" | "description" | "x" | "y" | "color" | "status" | "sessionKeys">>,
): void {
  const graph = state.mindmapGraph;
  if (!graph) {
    return;
  }
  graph.nodes = graph.nodes.map((n) =>
    n.id === nodeId ? { ...n, ...patch } : n,
  );
  state.mindmapGraph = { ...graph };
  saveMindmap(state);
}

export function removeNode(state: MindmapState, nodeId: MindmapNodeId): void {
  const graph = state.mindmapGraph;
  if (!graph) {
    return;
  }
  // Don't remove root node
  if (graph.nodes[0]?.id === nodeId) {
    return;
  }

  // Collect all descendants (BFS)
  const toRemove = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (toRemove.has(edge.from) && !toRemove.has(edge.to)) {
        toRemove.add(edge.to);
        changed = true;
      }
    }
  }

  graph.nodes = graph.nodes.filter((n) => !toRemove.has(n.id));
  graph.edges = graph.edges.filter(
    (e) => !toRemove.has(e.from) && !toRemove.has(e.to),
  );
  state.mindmapGraph = { ...graph };

  if (state.mindmapSelectedNodeId && toRemove.has(state.mindmapSelectedNodeId)) {
    state.mindmapSelectedNodeId = null;
  }
  if (state.mindmapEditingNodeId && toRemove.has(state.mindmapEditingNodeId)) {
    state.mindmapEditingNodeId = null;
  }
  saveMindmap(state);
}

// ── Session linking ──────────────────────────────────────────────────

export function linkSession(
  state: MindmapState,
  nodeId: MindmapNodeId,
  sessionKey: string,
): void {
  const graph = state.mindmapGraph;
  if (!graph) return;
  graph.nodes = graph.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const keys = n.sessionKeys ?? [];
    if (keys.includes(sessionKey)) return n;
    return { ...n, sessionKeys: [...keys, sessionKey] };
  });
  state.mindmapGraph = { ...graph };
  saveMindmap(state);
}

export function unlinkSession(
  state: MindmapState,
  nodeId: MindmapNodeId,
  sessionKey: string,
): void {
  const graph = state.mindmapGraph;
  if (!graph) return;
  graph.nodes = graph.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const keys = (n.sessionKeys ?? []).filter((k) => k !== sessionKey);
    return { ...n, sessionKeys: keys.length > 0 ? keys : undefined };
  });
  state.mindmapGraph = { ...graph };
  saveMindmap(state);
}

export async function refreshNodeSessions(state: MindmapState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    if (res) {
      res.sessions = res.sessions.filter(s => !s.key.startsWith("summary:"));
      state.mindmapSessionsResult = res;
    }
  } catch {
    // Silently ignore — sessions panel is secondary
  }
// Also fetch chat previews for all linked sessions
  await fetchChatPreviews(state);
}

export function scrollMindmapChatsToBottom() {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      const els = document.querySelectorAll('.mm-chat-messages');
      els.forEach((el) => {
        el.scrollTop = el.scrollHeight;
      });
    }, 100);
  });
}

function extractTextFromMessage(msg: unknown): string | null {
  const m = msg as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((p: unknown) => {
        const item = p as Record<string, unknown>;
        return item.type === "text" && typeof item.text === "string";
      })
      .map((p: unknown) => (p as Record<string, unknown>).text as string);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  return null;
}

const activeSummaries = new Set<string>(); // runIds

async function requestLLMSummary(state: MindmapState, node: MindmapNode, lines: ChatPreviewLine[]) {
  if (!state.client || !state.connected || !node.sessionKeys || node.sessionKeys.length === 0) return;

  const sessionKey = node.sessionKeys[0];
  const idempotencyKey = "mm-sum-" + generateUUID();
  activeSummaries.add(idempotencyKey);

  const lastAssistantLine = lines.findLast(l => l.role === 'assistant' && !l.isSummary);
  if (!lastAssistantLine) {
    activeSummaries.delete(idempotencyKey);
    return;
  }
  
  const prompt = `[Summary Request]: Summarize your last message in exactly one short, descriptive sentence (max 90 characters). 
Focus on the core action taken or the conclusion reached. Use active voice. 
Your response MUST start with "[Node Summary]:".

Assistant Message:
${lastAssistantLine.text}`;

  try {
    node.lastSummaryMessageCount = lines.length;
    saveMindmap(state);

    await state.client.request("agent", {
      message: prompt,
      sessionKey,
      idempotencyKey,
      deliver: false,
    });
  } catch (err) {
    console.error("LLM Summary request failed", err);
    activeSummaries.delete(idempotencyKey);
  }
}

function generateChatSummary(lines: ChatPreviewLine[]): string {
  if (lines.length === 0) return "";
  const lastAssistant = lines.findLast(l => l.role === 'assistant' && !l.isSummary);
  const targetText = lastAssistant ? lastAssistant.text : lines[lines.length - 1].text;
  
  const cleanText = targetText
    .replace(/\[Node Summary\]:.*$/g, "")
    .replace(/\[Summary Request\]:.*$/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*`#\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText) return "Working…";
  
  const match = cleanText.match(/^[^.!?]*[.!?]/);
  let sentence = match ? match[0].trim() : cleanText;
  if (sentence.length > 90) {
    sentence = sentence.slice(0, 87) + "...";
  }
  return sentence;
}

export async function fetchChatPreviews(state: MindmapState): Promise<void> {
  if (!state.client || !state.connected || !state.mindmapGraph) return;

  const allKeys = new Set<string>();
  for (const node of state.mindmapGraph.nodes) {
    for (const key of node.sessionKeys ?? []) {
      allKeys.add(key);
    }
  }
  if (allKeys.size === 0) return;

  const previews = new Map<string, ChatPreviewLine[]>();

  await Promise.all(
    [...allKeys].map(async (sessionKey) => {
      try {
        const res = await state.client!.request<{ messages?: unknown[] }>("chat.history", {
          sessionKey,
          limit: 30,
        });
        const messages = res.messages ?? [];
        const lines: ChatPreviewLine[] = [];
        for (const msg of messages.slice(-23)) {
          const m = msg as Record<string, unknown>;
          const role = m.role === "user" ? "user" : "assistant";
          const text = extractTextFromMessage(msg);
          if (text) {
            const isSummary = text.includes("[Node Summary]:") || text.includes("[Summary Request]:");
            lines.push({ role, text, isSummary });
          }
        }
        if (lines.length > 0) {
          previews.set(sessionKey, lines);
          const node = state.mindmapGraph!.nodes.find(n => n.sessionKeys && n.sessionKeys.includes(sessionKey));
          if (node) {
            const visibleLines = lines.filter(l => !l.isSummary);
            const lastIsAssistant = visibleLines.length > 0 && visibleLines[visibleLines.length - 1].role === 'assistant';
            const shouldLLM = lastIsAssistant && (node.lastSummaryMessageCount === undefined || visibleLines.length > node.lastSummaryMessageCount);
            
            if (shouldLLM) {
              void requestLLMSummary(state, node, visibleLines);
            }
            
            if (!node.description) {
              node.description = generateChatSummary(visibleLines);
            }
          }
        }
      } catch {
        // skip this session
      }
    }),
  );

  state.mindmapChatPreviews = previews;
  scrollMindmapChatsToBottom();
}

// ── Send chat message from mindmap ──────────────────────────────────

export async function sendChatFromMindmap(
  state: MindmapState,
  sessionKey: string,
  message: string,
): Promise<void> {
  if (!state.client || !state.connected || !message.trim()) return;

  const msg = message.trim();

  // Optimistic UI update
  handleSessionActivity(state, sessionKey, "active");
  
  const previews = state.mindmapChatPreviews;
  const lines = previews.get(sessionKey) || [];
  const newMap = new Map(previews);
  const newLines: ChatPreviewLine[] = [...lines, { role: "user", text: msg }];
  newMap.set(sessionKey, newLines);
  state.mindmapChatPreviews = newMap;
  
  const nodeToUpdate = state.mindmapGraph?.nodes.find(n => n.sessionKeys?.includes(sessionKey));
  if (nodeToUpdate) {
    const visibleLines = newLines.filter(l => !l.isSummary);
    if (!nodeToUpdate.description) {
      nodeToUpdate.description = generateChatSummary(visibleLines);
    }
    if (visibleLines.length > (nodeToUpdate.lastSummaryMessageCount ?? 0) && visibleLines.length > 0 && visibleLines[visibleLines.length - 1].role === 'assistant') {
      void requestLLMSummary(state, nodeToUpdate, visibleLines);
    }
  }
  
  scrollMindmapChatsToBottom();

  try {
    await state.client.request("chat.send", {
      sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: generateUUID(),
    });
  } catch {
    // silently fail
  }
}

// ── Reset ────────────────────────────────────────────────────────────

export function deleteMindmap(state: MindmapState): void {
  // Clear localStorage FIRST so loadMindmap can't reload stale data
  try {
    localStorage.removeItem(storageKey(state));
  } catch {
    // Ignore
  }
  // Clear all mindmap state
  state.mindmapGraph = null;
  state.mindmapSelectedNodeId = null;
  state.mindmapEditingNodeId = null;
  state.mindmapChatPreviews = new Map();
}

// ── Agent Event Processing ──────────────────────────────────────────

const nodeStatusTimers = new Map<MindmapNodeId, number>();

export function updateNodeStatus(state: MindmapState, nodeId: MindmapNodeId, status: "idle" | "active" | "done") {
  const graph = state.mindmapGraph;
  if (!graph) return;
  
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return;
  
  if (nodeStatusTimers.has(nodeId)) {
    window.clearTimeout(nodeStatusTimers.get(nodeId));
    nodeStatusTimers.delete(nodeId);
  }
  
  if (node.status !== status) {
    updateNode(state, nodeId, { status });
  }
  
  if (status === "done") {
    const timer = window.setTimeout(() => {
      updateNodeStatus(state, nodeId, "idle");
    }, 43000);
    nodeStatusTimers.set(nodeId, timer);
  }
}

export function handleSessionActivity(state: MindmapState, sessionKey: string, status: "active" | "done") {
  if (!state.mindmapGraph) return;
  for (const node of state.mindmapGraph.nodes) {
    if (node.sessionKeys?.includes(sessionKey)) {
      updateNodeStatus(state, node.id, status);
    }
  }
}

export function processMindmapAgentEvent(state: MindmapState, payload: AgentEventPayload): void {
  if (payload.sessionKey) {
    if (payload.sessionKey.startsWith("summary:")) return;
    handleSessionActivity(state, payload.sessionKey, "active");
  }

  // Let's accept any tool call that finished successfully and smells like sessions_spawn
  if (
    payload.stream !== "tool" ||
    !payload.data ||
    payload.data.phase !== "result" ||
    !payload.data.result
  ) {
    return;
  }
  
  const name = payload.data.name as string | undefined;
  if (!name || (!name.includes("sessions_spawn") && !name.includes("subagent"))) {
    return;
  }
  
  const graph = state.mindmapGraph;
  if (!graph) return;

  try {
    const res = payload.data.result as { childSessionKey?: string, sessionKey?: string, status?: string };
    const childKey = res.childSessionKey || res.sessionKey;
    if (!childKey) return;
    
    // Automatically perform a full graph layout sync to pull in the newly discovered subagent!
    void autoLayoutMindmap(state, { quiet: true });
  } catch {
    // ignore
  }
}

export function processMindmapChatEvent(state: MindmapState, payload: ChatEventPayload): void {
  const { sessionKey, state: chatState, message } = payload;
  const graph = state.mindmapGraph;
  if (!graph) return;

  // Check if session belongs to any mindmap node
  const linked = graph.nodes.some(n => n.sessionKeys?.includes(sessionKey));
  if (!linked) return;

  if (chatState === "final" || chatState === "aborted" || chatState === "error") {
    handleSessionActivity(state, sessionKey, "done");
    // Re-fetch everything cleanly on final/error
    void fetchChatPreviews(state);
    return;
  }

  if (chatState === "delta") {
    handleSessionActivity(state, sessionKey, "active");
    // Live update the previews
    const text = extractText(message);
    if (!text) return;

    const isSummaryRequest = text.includes("[Summary Request]:");
    const isSummaryResponse = text.includes("[Node Summary]:");

    const previews = state.mindmapChatPreviews;
    let lines = previews.get(sessionKey);
    if (!lines) {
      lines = [];
    }

    // Work on a copy of the lines to trigger reactivity
    const newLines = [...lines];
    const lastLineIndex = newLines.findLastIndex(l => l.role === "assistant");
    
    if (lastLineIndex >= 0 && !isSummaryRequest && !isSummaryResponse) {
      newLines[lastLineIndex] = { ...newLines[lastLineIndex], text };
    } else {
      newLines.push({ role: "assistant", text, isSummary: isSummaryRequest || isSummaryResponse });
    }

    // Set a new Map reference to ensure the UI updates
    const newMap = new Map(previews);
    newMap.set(sessionKey, newLines);
    state.mindmapChatPreviews = newMap;
    
    const nodeToUpdate = graph.nodes.find(n => n.sessionKeys?.includes(sessionKey));
    if (nodeToUpdate) {
      const visibleLines = newLines.filter(l => !l.isSummary);
      if (!nodeToUpdate.description || isSummaryResponse) {
        nodeToUpdate.description = generateChatSummary(visibleLines);
      }
    }
    
    scrollMindmapChatsToBottom();
  }
}

export function handleMindmapSummaryEvent(state: MindmapState, payload: ChatEventPayload): void {
  const { sessionKey, state: chatState, message } = payload;
  const graph = state.mindmapGraph;
  if (!graph) return;

  const text = extractText(message);
  if (!text || !text.includes("[Node Summary]:")) return;

  const node = graph.nodes.find(n => n.sessionKeys?.includes(sessionKey));
  if (!node) return;

  if (chatState === "delta" || chatState === "final") {
    const cleanText = text.replace("[Node Summary]:", "").replace(/["']/g, "").trim();
    if (cleanText && cleanText.length > 5) {
      node.description = cleanText;
      if (chatState === "final") {
        saveMindmap(state);
      }
    }
  }
}

// ── Auto Layout ──────────────────────────────────────────────────────

export async function autoLayoutMindmap(state: MindmapState, options?: { quiet?: boolean }): Promise<void> {
  console.log("autoLayoutMindmap: start", { hasSessionsResult: !!state.mindmapSessionsResult });
  
  // We should force a refresh so we always get the *latest* sessions.
  // The user expects active sessions running right now.
  await refreshNodeSessions(state);

  const sessions = state.mindmapSessionsResult?.sessions ?? [];
  console.log("autoLayoutMindmap: total sessions found:", sessions.length);
  if (sessions.length === 0) {
    console.log("autoLayoutMindmap: no sessions available, returning early.");
    if (!options?.quiet) {
      window.alert("No active sessions found! Please click '↻ Sessions' and try again, or make sure your agent has spawned operations.");
    }
    return;
  }

  const mainSessions = sessions.filter(s => !s.key.includes(":subagent:") && !s.key.startsWith("summary:"));
  
  // Prioritize sessions ending in ":main", "global", or exactly "main"
  const prioritized = mainSessions.filter(s => s.key.endsWith(":main") || s.key === "global" || s.key === "main");
  
  console.log("autoLayoutMindmap: main sessions:", mainSessions.length, "prioritized:", prioritized.length);
  const mainSession = 
    prioritized.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] 
    ?? mainSessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    ?? sessions.filter(s => !s.key.startsWith("summary:"))[0];
    
  if (!mainSession) {
    console.log("autoLayoutMindmap: no sessions available, returning early.");
    return;
  }
  
  let epicTitle = (state as any).assistantName;
  
  if (!epicTitle || epicTitle === "Assistant") {
    epicTitle = mainSession.label || mainSession.displayName;
    if (!epicTitle || epicTitle === mainSession.key) {
      const parts = mainSession.key.split(":");
      const agentId = (parts[0] === "agent" && parts[1]) ? parts[1] : null;
      let agentName = agentId;
      if (agentId && state.agentsList?.agents) {
        const agentInfo = state.agentsList.agents.find(a => a.id === agentId);
        if (agentInfo?.identity?.name) {
          agentName = agentInfo.identity.name;
        } else if (agentInfo?.name) {
          agentName = agentInfo.name;
        }
      }
      epicTitle = agentName || "Main Epic";
    }
  }
  
  if (!state.mindmapGraph) {
    console.log("autoLayoutMindmap: creating mindmap...");
    createMindmap(state, epicTitle);
  } else if (state.mindmapGraph.nodes.length > 0) {
    if (!state.mindmapGraph.nodes[0].label || state.mindmapGraph.nodes[0].label === "Main Epic") {
      state.mindmapGraph.nodes[0].label = epicTitle;
    }
  }
  
  const graph = state.mindmapGraph;
  if (!graph) return;
  
  // Link the main session to the epic root
  const epicNodeId = graph.nodes[0].id;
  linkSession(state, epicNodeId, mainSession.key);

  // Find all subagent sessions
  const subagents = sessions.filter(s => s.key.includes(":subagent:"));
  
  // Sort subagents by time
  subagents.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  
  const now = Date.now();
  
  for (const sub of subagents) {
    const subTitle = sub.label || sub.displayName || `Task ${sub.key.split(":").pop()?.substring(0, 6)}`;
    
    // IF node for this session already exists, DO NOT DUPLICATE IT
    const exists = graph.nodes.some(n => n.sessionKeys && n.sessionKeys.includes(sub.key));
    if (exists) continue;
    
    const shortLabel = subTitle.length > 50 ? subTitle.slice(0, 47) + "..." : subTitle;
    const childId = generateUUID();
    
    graph.nodes.push({
      id: childId,
      label: shortLabel,
      x: 0,
      y: 0,
      parentId: epicNodeId,
      status: "idle",
      createdAt: now,
      sessionKeys: [sub.key]
    });
    
    graph.edges.push({ from: epicNodeId, to: childId });
  }
  
  applyRadialLayout(graph);
  
  state.mindmapGraph = { ...graph };
  saveMindmap(state);
}
