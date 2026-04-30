// Client-side WebSocket wrapper for Blokus multiplayer.
// Handles connect/rejoin/sendMove and exposes an onEvent callback.
// GameState.remaining uses Set<string>, which isn't JSON-serializable,
// so we convert to/from string[] at the boundary here.

export type PlayerId = "A" | "B";
export type ColorId = 1 | 2 | 3 | 4;

// Wire-format for GameState (Sets → arrays for JSON).
export interface SerializedState {
  board: number[][];
  current: ColorId;
  remaining: Record<string, string[]>; // "1"|"2"|"3"|"4" → piece id array
  history: Array<{ color: ColorId; pieceId: string; cells: [number, number][] }>;
  consecutivePasses: number;
  lastPlacedWasMonomino: Record<string, boolean>;
  finished: Record<string, boolean>;
  passed: Record<string, boolean>;
}

export type ServerEvent =
  | { type: "waiting" }
  | { type: "start";               playerId: PlayerId; opponentName: string; token: string }
  | { type: "rejoined";            playerId: PlayerId; opponentName: string; state: SerializedState | null }
  | { type: "state";               state: SerializedState }
  | { type: "opponent_disconnected" }
  | { type: "opponent_reconnected" }
  | { type: "reconnecting" };      // emitted locally by the socket class

const SESSION_KEY = "blokus_token";
const MAX_RETRIES = 20;   // 20 × 3s = 60s total retry window
const RETRY_MS    = 3_000;

export class BlokusSocket {
  private ws: WebSocket | null = null;
  private wsUrl = "";
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;

  onEvent?: (event: ServerEvent) => void;

  // ── Public API ────────────────────────────────────────────────────────────

  connect(url: string, name: string, preferredSide: "A" | "B"): void {
    this.wsUrl = url;
    this._dial(() => this._send({ type: "join", name, preferredSide }));
  }

  sendMove(state: SerializedState): void {
    this._send({ type: "move", state });
  }

  /** Call on intentional close (reset, unmount). Clears session so no auto-retry. */
  close(): void {
    this._clearToken();
    this._cancelRetry();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _dial(onOpen: () => void): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      onOpen();
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerEvent & { token?: string };

        // Persist token so we can rejoin after a disconnect.
        if (msg.type === "start" && msg.token) {
          this._saveToken(msg.token);
        }

        // Handle rejoin failure internally — surface as a generic disconnect.
        if ((msg as { type: string }).type === "rejoin_failed") {
          this._clearToken();
          this.onEvent?.({ type: "opponent_disconnected" });
          return;
        }

        this.onEvent?.(msg);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // stale handler from a previous socket
      const token = this._loadToken();
      if (token) {
        this._scheduleRetry(token);
      } else {
        this.onEvent?.({ type: "opponent_disconnected" });
      }
    };
  }

  private _scheduleRetry(token: string): void {
    if (this.retries >= MAX_RETRIES) {
      this._clearToken();
      this.onEvent?.({ type: "opponent_disconnected" });
      return;
    }
    this.retries++;
    this.onEvent?.({ type: "reconnecting" });

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._dial(() => this._send({ type: "rejoin", token }));
    }, RETRY_MS);
  }

  private _cancelRetry(): void {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  private _send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private _saveToken(token: string): void {
    try { sessionStorage.setItem(SESSION_KEY, token); } catch {}
  }

  private _loadToken(): string | null {
    try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; }
  }

  private _clearToken(): void {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }
}
