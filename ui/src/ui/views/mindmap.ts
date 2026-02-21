import { html, svg, nothing } from "lit";
import type {
  MindmapGraph,
  MindmapNode,
  MindmapNodeId,
  SessionsListResult,
  GatewaySessionRow,
} from "../types.ts";
import type { ChatPreviewLine } from "../controllers/mindmap.ts";

// ── Props ────────────────────────────────────────────────────────────

export type MindmapProps = {
  graph: MindmapGraph | null;
  selectedNodeId: MindmapNodeId | null;
  editingNodeId: MindmapNodeId | null;
  pan: { x: number; y: number };
  zoom: number;
  sessionsResult: SessionsListResult | null;
  chatPreviews: Map<string, ChatPreviewLine[]>;
  onCreateMindmap: (title: string) => void;
  onAddNode: (label: string, parentId?: MindmapNodeId) => void;
  onUpdateNode: (nodeId: MindmapNodeId, patch: Partial<MindmapNode>) => void;
  onRemoveNode: (nodeId: MindmapNodeId) => void;
  onSelectNode: (nodeId: MindmapNodeId | null) => void;
  onEditNode: (nodeId: MindmapNodeId | null) => void;
  onLinkSession: (nodeId: MindmapNodeId, sessionKey: string) => void;
  onUnlinkSession: (nodeId: MindmapNodeId, sessionKey: string) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onNodeMove: (nodeId: MindmapNodeId, x: number, y: number) => void;
  onRefresh: () => void;
  onDelete: () => void;
  onSendChat: (sessionKey: string, message: string) => void;
  onAutoLayout: () => void;
};

// ── Constants ────────────────────────────────────────────────────────

const ROOT_RADIUS = 60;
const CHILD_RADIUS = 38;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

const STATUS_LABELS: Record<string, string> = {
  idle: "⏸ Idle",
  active: "▶ Active",
  done: "✓ Done",
};

// ── Helpers ──────────────────────────────────────────────────────────

function findSessionsForNode(
  node: MindmapNode,
  sessions: GatewaySessionRow[],
): GatewaySessionRow[] {
  const keys = node.sessionKeys ?? [];
  if (keys.length === 0) return [];
  return sessions.filter((s) => keys.includes(s.key));
}

function truncateLabel(label: string, maxLen = 16): string {
  return label.length > maxLen ? label.slice(0, maxLen - 1) + "…" : label;
}

function formatTokens(n?: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ── Chat preview lines for a node ────────────────────────────────────

function getFirstSessionKey(node: MindmapNode): string | null {
  return (node.sessionKeys ?? [])[0] ?? null;
}

function getChatPreviewForNode(
  node: MindmapNode,
  chatPreviews: Map<string, ChatPreviewLine[]>,
): ChatPreviewLine[] {
  const keys = node.sessionKeys ?? [];
  const allLines: ChatPreviewLine[] = [];
  for (const key of keys) {
    const lines = chatPreviews.get(key);
    if (lines) allLines.push(...lines);
  }
  return allLines.slice(-23);
}

// ── Format message text with code block highlighting ─────────────────

function highlightJson(json: string) {
  // Simple JSON syntax highlighting via regex replacement
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const highlighted = escaped
    // strings (keys and values)
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="mm-json-key">$1</span>:',
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="mm-json-string">$1</span>',
    )
    // standalone strings (in arrays etc)
    .replace(
      /(?<=[[,\s])("(?:[^"\\]|\\.)*")(?=[,\]\s])/g,
      '<span class="mm-json-string">$1</span>',
    )
    // numbers
    .replace(
      /:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      ': <span class="mm-json-number">$1</span>',
    )
    // booleans and null
    .replace(
      /\b(true|false|null)\b/g,
      '<span class="mm-json-bool">$1</span>',
    );

  return highlighted;
}

function formatChatText(text: string) {
  // Split on code fences: ```lang\n...\n```
  const parts: Array<{ type: "text" | "code"; content: string; lang?: string }> = [];
  const fenceRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: "code", content: match[2], lang: match[1] || "text" });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex);
    parts.push({ type: "text", content: remaining });
  }

  // If no code fences found, check if the entire text looks like JSON
  if (parts.length === 1 && parts[0].type === "text") {
    const trimmed = parts[0].content.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        JSON.parse(trimmed);
        parts[0] = { type: "code", content: trimmed, lang: "json" };
      } catch {
        // not valid JSON, keep as text
      }
    }
  }

  return parts.map((part) => {
    if (part.type === "code") {
      const isJson = part.lang === "json" || part.lang === "jsonc";
      const content = part.content.trim();
      const inner = isJson ? highlightJson(content) : content
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const langLabel = part.lang && part.lang !== "text" ? part.lang : "";
      return html`
        <div class="mm-code-block">
          ${langLabel ? html`<div class="mm-code-lang">${langLabel}</div>` : nothing}
          <pre .innerHTML=${inner}></pre>
        </div>
      `;
    }
    return html`<span>${part.content}</span>`;
  });
}

// ── Empty state — Create Epic ────────────────────────────────────────

function renderEmptyState(props: MindmapProps) {
  return html`
    <div class="mm-empty-wrap">
      <svg class="mm-empty-bg" viewBox="0 0 400 400" preserveAspectRatio="xMidYMid meet">
        <circle cx="200" cy="200" r="120" fill="none" stroke="#6366f1" stroke-width="1" opacity="0.1"></circle>
        <circle cx="200" cy="200" r="80" fill="none" stroke="#6366f1" stroke-width="1" opacity="0.15"></circle>
        <circle cx="200" cy="200" r="40" fill="none" stroke="#6366f1" stroke-width="2" opacity="0.2"></circle>
        <circle cx="200" cy="200" r="6" fill="#6366f1" opacity="0.4"></circle>
      </svg>
      <div class="mm-empty">
        <div class="mm-empty-icon">🧠</div>
        <h2 class="mm-empty-title">Agent Mindmap</h2>
        <p class="mm-empty-sub">
          Create an epic task to start your mindmap. Break it into subtasks
          and link each to a live agent session.
        </p>

        <button class="mm-create-btn" style="background: #334155; border-color: #475569;" @click=${props.onAutoLayout}>
          🪄 Auto-Sync from Active Sessions
        </button>

        <p class="mm-empty-hint">
          Tip: After creating, click on the epic node to add subtasks and link sessions.
        </p>
      </div>
    </div>
  `;
}

// ── SVG edge ─────────────────────────────────────────────────────────

function renderEdge(
  fromNode: MindmapNode,
  toNode: MindmapNode,
  isChildActive: boolean,
  isChildLinked: boolean,
) {
  const mx = (fromNode.x + toNode.x) / 2;
  const my = (fromNode.y + toNode.y) / 2;
  const dx = toNode.x - fromNode.x;
  const dy = toNode.y - fromNode.y;
  const off = Math.min(Math.sqrt(dx * dx + dy * dy) * 0.15, 30);
  const cx = mx - (dy / (Math.abs(dy) || 1)) * off * 0.3;
  const cy = my + (dx / (Math.abs(dx) || 1)) * off * 0.3;

  const strokeColor = isChildActive ? "#3b82f6" : isChildLinked ? "#8b5cf6" : "#475569";

  return svg`
    <path
      class="mm-edge ${isChildActive ? "mm-edge--active" : ""} ${isChildLinked ? "mm-edge--linked" : ""}"
      d="M ${fromNode.x} ${fromNode.y} Q ${cx} ${cy} ${toNode.x} ${toNode.y}"
      stroke=${strokeColor}
      stroke-width=${isChildActive ? 2.5 : 1.8}
      fill="none"
      stroke-opacity=${isChildActive ? 0.8 : 0.4}
      stroke-linecap="round"
    />
  `;
}

// ── Interactive chat bubble (HTML overlay, centered below node) ──────

function renderChatBubble(
  node: MindmapNode,
  isRoot: boolean,
  chatLines: ChatPreviewLine[],
  sessionKey: string | null,
  props: MindmapProps,
) {
  if (!sessionKey) return nothing;

  const r = isRoot ? ROOT_RADIUS : CHILD_RADIUS;
  const bubbleW = 340;
  const bubbleH = 400;
  const bubbleY = r + 18;

  return svg`
    <g transform="translate(${node.x}, ${node.y})">
      <!-- Connector line -->
      <line x1="0" y1=${r + 6} x2="0" y2=${bubbleY}
        stroke="#6366f1" stroke-width="1" opacity="0.3" stroke-dasharray="3 3" />

      <!-- Chat bubble via foreignObject -->
      <foreignObject
        x=${-bubbleW / 2} y=${bubbleY}
        width=${bubbleW} height=${bubbleH}
        class="mm-chat-fo"
      >
        <div xmlns="http://www.w3.org/1999/xhtml" class="mm-chat-box"
          @pointerdown=${(e: Event) => e.stopPropagation()}
          @wheel=${(e: Event) => e.stopPropagation()}>
          <div class="mm-chat-box-header">
            <span class="mm-chat-box-title">\uD83D\uDCAC ${sessionKey}</span>
          </div>

          <div class="mm-chat-messages">
            ${chatLines.length > 0
              ? chatLines.map(
                  (line) => html`
                    <div class="mm-chat-msg mm-chat-msg--${line.role}">
                      <span class="mm-chat-msg-icon">${line.role === "user" ? "\uD83D\uDC64" : "\uD83E\uDD16"}</span>
                      <span class="mm-chat-msg-text">${formatChatText(line.text)}</span>
                    </div>
                  `,
                )
              : html`<div class="mm-chat-empty">No messages yet. Say hi!</div>`}
          </div>

          <form class="mm-chat-input-row" @submit=${(e: Event) => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).querySelector("input") as HTMLInputElement;
            const msg = input?.value.trim();
            if (msg && sessionKey) {
              props.onSendChat(sessionKey, msg);
              input.value = "";
            }
          }}>
            <input type="text" class="mm-chat-input" placeholder="Type a message\u2026"
              autocomplete="off" />
            <button type="submit" class="mm-chat-send">\u27A4</button>
          </form>
        </div>
      </foreignObject>
    </g>
  `;
}

// ── SVG node ─────────────────────────────────────────────────────────

function renderNode(
  node: MindmapNode,
  isRoot: boolean,
  isSelected: boolean,
  linkedSessions: GatewaySessionRow[],
  props: MindmapProps,
) {
  const r = isRoot ? ROOT_RADIUS : CHILD_RADIUS;
  const status = node.status ?? "idle";
  const sessionCount = linkedSessions.length;
  const hasAnySession = sessionCount > 0;
  const totalTok = linkedSessions.reduce((sum, s) => sum + (s.totalTokens ?? 0), 0);

  let fill = "#1e293b";
  let strokeCol = "#334155";
  if (isRoot) { fill = "#6366f1"; strokeCol = "#818cf8"; }
  else if (status === "done") { fill = "#16a34a"; strokeCol = "#4ade80"; }
  else if (status === "active") { fill = "#2563eb"; strokeCol = "#60a5fa"; }

  const label = truncateLabel(node.label);

  return svg`
    <g
      class="mm-node ${isSelected ? "mm-node--selected" : ""} ${isRoot ? "mm-node--root" : ""}"
      transform="translate(${node.x}, ${node.y})"
      style="cursor: pointer"
      @pointerdown=${(e: PointerEvent) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        props.onSelectNode(node.id);
        const startX = e.clientX;
        const startY = e.clientY;
        const origX = node.x;
        const origY = node.y;
        let moved = false;
        const onMove = (me: PointerEvent) => {
          const ddx = (me.clientX - startX) / props.zoom;
          const ddy = (me.clientY - startY) / props.zoom;
          if (!moved && Math.abs(ddx) + Math.abs(ddy) < 4) return;
          moved = true;
          props.onNodeMove(node.id, origX + ddx, origY + ddy);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      }}
    >
      ${status === "active"
        ? svg`<circle cx="0" cy="0" r=${r + 10} fill="none" stroke="#3b82f6"
              stroke-width="1.5" opacity="0.3" class="mm-pulse-ring" />`
        : nothing}

      ${isSelected
        ? svg`<circle cx="0" cy="0" r=${r + 5} fill="none"
              stroke="#f59e0b" stroke-width="2.5"
              stroke-dasharray="6 3" class="mm-select-ring" />`
        : nothing}

      ${isRoot
        ? svg`<circle cx="0" cy="0" r=${r + 12} fill="none" stroke="#6366f1" stroke-width="0.5"
              opacity="0.25" stroke-dasharray="4 6" class="mm-orbit-ring" />`
        : nothing}

      <circle cx="0" cy="0" r=${r} fill=${fill} stroke=${strokeCol} stroke-width="2" />

      ${isRoot
        ? svg`<text x="0" y="-10" text-anchor="middle" dominant-baseline="central"
            font-size="18" pointer-events="none">🎯</text>`
        : nothing}

      <text x="0" y=${isRoot ? 10 : (hasAnySession ? -6 : 0)} text-anchor="middle" dominant-baseline="central"
        fill=${isRoot ? "#ffffff" : "#e2e8f0"}
        font-size=${isRoot ? "12" : "11"} font-weight=${isRoot ? "700" : "600"}
        class="mm-node-label" pointer-events="none">
        ${label}
      </text>

      ${hasAnySession && !isRoot
        ? svg`<text x="0" y="10" text-anchor="middle" dominant-baseline="central"
            fill="#94a3b8" font-size="8" opacity="0.7" pointer-events="none">
            ${sessionCount} session${sessionCount > 1 ? "s" : ""} · ${formatTokens(totalTok)} tok
          </text>`
        : nothing}

      <circle cx="0" cy=${r + 10} r="4"
        fill=${status === "done" ? "#22c55e" : status === "active" ? "#3b82f6" : "#6b7280"} />

      ${hasAnySession
        ? svg`<g transform="translate(${r - 4}, ${-r + 4})">
            <circle cx="0" cy="0" r="10" fill="#0f172a" opacity="0.9" />
            <text x="0" y="0" text-anchor="middle" dominant-baseline="central"
              fill="#818cf8" font-size="9" font-weight="700" pointer-events="none">
              ${sessionCount}
            </text>
          </g>`
        : nothing}

      ${isRoot && !isSelected && props.graph && props.graph.nodes.length === 1
        ? svg`<text x="0" y=${r + 24} text-anchor="middle" dominant-baseline="central"
            fill="#94a3b8" font-size="9" opacity="0.5" pointer-events="none" class="mm-hint-text">
            ↑ click to add subtasks
          </text>`
        : nothing}
    </g>
  `;
}

// ── Detail sidebar ───────────────────────────────────────────────────

function renderDetailPanel(
  node: MindmapNode,
  isRoot: boolean,
  allSessions: GatewaySessionRow[],
  linkedSessions: GatewaySessionRow[],
  props: MindmapProps,
) {
  const status = node.status ?? "idle";
  const linkedKeys = new Set(node.sessionKeys ?? []);
  const availableSessions = allSessions.filter((s) => !linkedKeys.has(s.key));

  return html`
    <aside class="mm-detail">
      <div class="mm-detail-header">
        <h3 class="mm-detail-title">
          ${isRoot ? "🎯 Epic Task" : "📌 Subtask"}
        </h3>
        <button class="mm-detail-close" @click=${() => props.onSelectNode(null)}
          title="Close">✕</button>
      </div>

      <div class="mm-detail-status mm-detail-status--${status}">
        ${STATUS_LABELS[status] ?? status}
      </div>

      <label class="mm-detail-field">
        <span>Label</span>
        <input .value=${node.label} @change=${(e: Event) => {
          const v = (e.target as HTMLInputElement).value.trim();
          if (v) props.onUpdateNode(node.id, { label: v });
        }} />
      </label>

      <label class="mm-detail-field">
        <span>Description</span>
        <textarea rows="3" .value=${node.description ?? ""}
          placeholder="What does this task involve…"
          @change=${(e: Event) => {
            props.onUpdateNode(node.id, { description: (e.target as HTMLTextAreaElement).value });
          }}></textarea>
      </label>

      <label class="mm-detail-field">
        <span>Status</span>
        <select @change=${(e: Event) => {
          props.onUpdateNode(node.id, { status: (e.target as HTMLSelectElement).value as "idle" | "active" | "done" });
        }}>
          ${(["idle", "active", "done"] as const).map(
            (s) => html`<option value=${s} ?selected=${status === s}>${STATUS_LABELS[s]}</option>`,
          )}
        </select>
      </label>

      <div class="mm-detail-section">
        <h4>🔗 Linked Sessions (${linkedSessions.length})</h4>

        ${linkedSessions.length > 0
          ? html`<div class="mm-sessions-list">
              ${linkedSessions.map((s) => html`
                <div class="mm-session-card">
                  <div class="mm-session-card-header">
                    <span class="mm-session-card-key mono">${s.key}</span>
                    <button class="mm-session-unlink" title="Unlink"
                      @click=${() => props.onUnlinkSession(node.id, s.key)}>✕</button>
                  </div>
                  <div class="mm-session-card-meta">
                    <span>${s.kind}</span>
                    <span>${s.model ?? "—"}</span>
                    <span>${timeAgo(s.updatedAt)}</span>
                  </div>
                  <div class="mm-session-card-stats">
                    <div class="mm-session-stat">
                      <span class="mm-session-stat-val">${formatTokens(s.inputTokens)}</span>
                      <span class="mm-session-stat-label">in</span>
                    </div>
                    <div class="mm-session-stat">
                      <span class="mm-session-stat-val">${formatTokens(s.outputTokens)}</span>
                      <span class="mm-session-stat-label">out</span>
                    </div>
                    <div class="mm-session-stat">
                      <span class="mm-session-stat-val">${formatTokens(s.totalTokens)}</span>
                      <span class="mm-session-stat-label">total</span>
                    </div>
                  </div>
                </div>
              `)}
            </div>`
          : nothing}


      </div>



      ${!isRoot
        ? html`
            <div class="mm-detail-actions">
              <button class="mm-delete-node-btn" @click=${() => {
                if (window.confirm(`Delete "${node.label}" and all children?`)) {
                  props.onRemoveNode(node.id);
                }
              }}>🗑 Delete task</button>
            </div>
          `
        : nothing}
    </aside>
  `;
}

// ── Toolbar ──────────────────────────────────────────────────────────

function renderToolbar(props: MindmapProps) {
  const nodeCount = props.graph?.nodes.length ?? 0;
  const linkedCount = props.graph?.nodes.filter((n) => (n.sessionKeys?.length ?? 0) > 0).length ?? 0;
  const zoomPct = Math.round(props.zoom * 100);

  return html`
    <div class="mm-toolbar">


      <button class="mm-toolbar-btn" title="Zoom out"
        @click=${() => props.onZoomChange(Math.max(props.zoom * 0.8, MIN_ZOOM))}>−</button>
      <span class="mm-toolbar-zoom">${zoomPct}%</span>
      <button class="mm-toolbar-btn" title="Zoom in"
        @click=${() => props.onZoomChange(Math.min(props.zoom * 1.25, MAX_ZOOM))}>+</button>
      <button class="mm-toolbar-btn" title="Reset view"
        @click=${() => { props.onPanChange({ x: 0, y: 0 }); props.onZoomChange(1); }}>⊞</button>

      <span class="mm-toolbar-divider"></span>

      <button class="mm-toolbar-btn" title="Refresh sessions" @click=${props.onRefresh}>
        ↻ Sessions
      </button>
      
      <button class="mm-toolbar-btn" title="Redraw based on active sessions" @click=${props.onAutoLayout}>
        🪄 Auto-Sync
      </button>

      <span class="mm-toolbar-stats">${nodeCount} nodes · ${linkedCount} linked</span>
      <span class="mm-toolbar-sep"></span>

      <button class="mm-toolbar-btn mm-toolbar-btn--danger" title="Delete mindmap"
        @click=${() => {
          if (window.confirm("Delete this entire mindmap? This cannot be undone.")) {
            props.onDelete();
          }
        }}>🗑</button>
    </div>
  `;
}

// ── Main render ──────────────────────────────────────────────────────

export function renderMindmap(props: MindmapProps) {
  if (!props.graph) {
    return renderEmptyState(props);
  }

  const graph = props.graph;
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const sessions = props.sessionsResult?.sessions ?? [];
  const selectedNode = props.selectedNodeId
    ? nodeMap.get(props.selectedNodeId) ?? null
    : null;
  const isRootSelected = selectedNode?.id === graph.nodes[0]?.id;

  // Collect nodes that have linked sessions for chat bubbles
  const nodesWithSessions = graph.nodes.filter(
    (n) => (n.sessionKeys?.length ?? 0) > 0,
  );

  return html`
    <div class="mm-container">
      ${renderToolbar(props)}

      <div
        class="mm-canvas-wrap"
        @wheel=${(e: WheelEvent) => {
          e.preventDefault();
          const factor = e.deltaY > 0 ? 0.92 : 1.08;
          props.onZoomChange(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, props.zoom * factor)));
        }}
        @pointerdown=${(e: PointerEvent) => {
          if (e.button !== 0) return;
          const startX = e.clientX;
          const startY = e.clientY;
          const origPan = { ...props.pan };
          const onMove = (me: PointerEvent) => {
            props.onPanChange({
              x: origPan.x + (me.clientX - startX),
              y: origPan.y + (me.clientY - startY),
            });
          };
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        }}
      >
        <svg class="mm-canvas" width="100%" height="100%"
          viewBox="-500 -400 1000 800" preserveAspectRatio="xMidYMid meet">
          <g transform="translate(${props.pan.x / props.zoom}, ${props.pan.y / props.zoom}) scale(${props.zoom})">
            ${graph.edges.map((edge) => {
              const from = nodeMap.get(edge.from);
              const to = nodeMap.get(edge.to);
              if (!from || !to) return nothing;
              const toLinked = (to.sessionKeys?.length ?? 0) > 0;
              return renderEdge(from, to, (to.status ?? "idle") === "active", toLinked);
            })}
            ${graph.nodes.map((node, i) => {
              const isRoot = i === 0;
              const chatLines = getChatPreviewForNode(node, props.chatPreviews);
              const sessionKey = getFirstSessionKey(node);
              return svg`
                ${renderNode(
                  node,
                  isRoot,
                  node.id === props.selectedNodeId,
                  findSessionsForNode(node, sessions),
                  props,
                )}
                ${node.id === props.selectedNodeId ? renderChatBubble(node, isRoot, chatLines, sessionKey, props) : nothing}
              `;
            })}
          </g>
        </svg>
      </div>

      ${selectedNode
        ? renderDetailPanel(
            selectedNode,
            isRootSelected,
            sessions,
            findSessionsForNode(selectedNode, sessions),
            props,
          )
        : nothing}
    </div>
  `;
}
