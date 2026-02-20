import { generateUUID } from "../uuid.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  MindmapGraph,
  MindmapNode,
  MindmapNodeId,
  SessionsListResult,
} from "../types.ts";

// ── State shape ──────────────────────────────────────────────────────

export type ChatPreviewLine = {
  role: "user" | "assistant";
  text: string;
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

function radialPosition(
  parent: MindmapNode,
  siblingCount: number,
  siblingIndex: number,
  radius = 180,
): { x: number; y: number } {
  const angle = (TWO_PI * siblingIndex) / Math.max(siblingCount, 1) - Math.PI / 2;
  return {
    x: parent.x + radius * Math.cos(angle),
    y: parent.y + radius * Math.sin(angle),
  };
}

export function addNode(
  state: MindmapState,
  label: string,
  parentId?: MindmapNodeId,
): MindmapNodeId | null {
  const graph = state.mindmapGraph;
  if (!graph) {
    return null;
  }

  const resolvedParentId = parentId ?? graph.nodes[0]?.id;
  const parent = graph.nodes.find((n) => n.id === resolvedParentId);
  if (!parent) {
    return null;
  }

  // Count existing children for position calculation
  const existingChildren = graph.edges.filter((e) => e.from === resolvedParentId).length;
  const totalChildren = existingChildren + 1;

  const pos = radialPosition(parent, totalChildren, existingChildren);
  const now = Date.now();

  const node: MindmapNode = {
    id: generateUUID(),
    label,
    x: pos.x,
    y: pos.y,
    parentId: resolvedParentId,
    status: "idle",
    createdAt: now,
  };

  graph.nodes = [...graph.nodes, node];
  graph.edges = [...graph.edges, { from: resolvedParentId, to: node.id }];
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
      state.mindmapSessionsResult = res;
    }
  } catch {
    // Silently ignore — sessions panel is secondary
  }
  // Also fetch chat previews for all linked sessions
  await fetchChatPreviews(state);
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
            lines.push({ role, text });

          }
        }
        if (lines.length > 0) {
          previews.set(sessionKey, lines);
        }
      } catch {
        // skip this session
      }
    }),
  );

  state.mindmapChatPreviews = previews;
}

// ── Send chat message from mindmap ──────────────────────────────────

export async function sendChatFromMindmap(
  state: MindmapState,
  sessionKey: string,
  message: string,
): Promise<void> {
  if (!state.client || !state.connected || !message.trim()) return;

  try {
    await state.client.request("chat.send", {
      sessionKey,
      message: message.trim(),
      deliver: false,
      idempotencyKey: generateUUID(),
    });

    // Wait a moment for the response, then refresh previews
    setTimeout(() => fetchChatPreviews(state), 2000);
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
  state.mindmapSessionsResult = null;
  state.mindmapChatPreviews = new Map();
}
