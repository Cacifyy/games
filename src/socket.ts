// Client-side WebSocket wrapper for Blokus multiplayer.
// Handles connect/join/sendMove and exposes an onEvent callback.
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
  | { type: "start"; playerId: PlayerId; opponentName: string }
  | { type: "state"; state: SerializedState }
  | { type: "opponent_disconnected" };

export class BlokusSocket {
  private ws: WebSocket | null = null;
  onEvent?: (event: ServerEvent) => void;

  connect(url: string, name: string, preferredSide: "A" | "B"): void {
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._send({ type: "join", name, preferredSide });
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerEvent;
        this.onEvent?.(msg);
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      this.onEvent?.({ type: "opponent_disconnected" });
    };
  }

  sendMove(state: SerializedState): void {
    this._send({ type: "move", state });
  }

  close(): void {
    // Prevent the onclose handler from firing a spurious disconnect event.
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private _send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }
}
