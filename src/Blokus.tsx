import React, { useEffect, useMemo, useRef, useState } from "react";
import { BlokusSocket, SerializedState, ServerEvent } from "./socket";

/**
 * Classic 4-color Blokus — single-file React + TypeScript implementation.
 *
 * Setup:
 *  - 20x20 board.
 *  - Four colors (Blue, Yellow, Red, Green) start in the four corners and
 *    play clockwise in that order.
 *  - Two human players share the four colors:
 *      Player A controls Blue (top-left) + Red (bottom-right) — diagonal pair
 *      Player B controls Yellow (top-right) + Green (bottom-left) — diagonal pair
 *  - Each color has the standard 21 Blokus polyominoes (89 squares per color).
 *
 * Rules implemented:
 *  - Each color's first piece must cover that color's starting corner.
 *  - Subsequent pieces of a color must touch at least one diagonal corner of
 *    one of the same color's already-placed pieces, and must NOT share an
 *    edge with any of that same color's pieces. Edge-touching other colors
 *    (including your other color!) is fine.
 *  - Pieces can be rotated 90° and flipped before placement.
 *  - When a color has no legal moves it auto-passes its turn.
 *  - Game ends when all four colors have passed back-to-back (or all finished).
 *  - Per-color score = -(squares of unplaced pieces); +15 for placing all 21,
 *    plus +5 if the last piece placed was the monomino. Player team score is
 *    the sum of their two colors.
 */

// -------------------- Types --------------------

type ColorId = 1 | 2 | 3 | 4; // 1=Blue, 2=Yellow, 3=Red, 4=Green
type PlayerId = "A" | "B";
type Cell = 0 | ColorId;
type Board = Cell[][];
type Shape = number[][];

interface PieceDef {
  id: string;
  shape: Shape;
}

interface PlacedPiece {
  color: ColorId;
  pieceId: string;
  cells: [number, number][];
}

export interface GameState {
  board: Board;
  current: ColorId;
  remaining: Record<ColorId, Set<string>>;
  history: PlacedPiece[];
  consecutivePasses: number;
  lastPlacedWasMonomino: Record<ColorId, boolean>;
  finished: Record<ColorId, boolean>;
  passed: Record<ColorId, boolean>;
}

// -------------------- Constants --------------------

const BOARD_SIZE = 20;

const COLOR_ORDER: ColorId[] = [1, 2, 3, 4];

const START_SQUARES: Record<ColorId, [number, number]> = {
  1: [0, 0],
  2: [0, BOARD_SIZE - 1],
  3: [BOARD_SIZE - 1, BOARD_SIZE - 1],
  4: [BOARD_SIZE - 1, 0],
};

const COLOR_NAME: Record<ColorId, string> = {
  1: "Blue",
  2: "Yellow",
  3: "Red",
  4: "Green",
};

const COLOR_HEX: Record<ColorId, string> = {
  1: "#2563eb",
  2: "#eab308",
  3: "#dc2626",
  4: "#16a34a",
};

const COLOR_LIGHT: Record<ColorId, string> = {
  1: "#bfdbfe",
  2: "#fde68a",
  3: "#fecaca",
  4: "#bbf7d0",
};

const COLORS_FOR: Record<PlayerId, ColorId[]> = {
  A: [1, 3],
  B: [2, 4],
};

const PLAYER_FOR_COLOR: Record<ColorId, PlayerId> = {
  1: "A",
  3: "A",
  2: "B",
  4: "B",
};

// -------------------- Piece definitions (21 standard) --------------------

const PIECES: PieceDef[] = [
  { id: "I1", shape: [[1]] },
  { id: "I2", shape: [[1, 1]] },
  { id: "I3", shape: [[1, 1, 1]] },
  { id: "V3", shape: [[1, 0], [1, 1]] },
  { id: "I4", shape: [[1, 1, 1, 1]] },
  { id: "L4", shape: [[1, 0], [1, 0], [1, 1]] },
  { id: "T4", shape: [[1, 1, 1], [0, 1, 0]] },
  { id: "S4", shape: [[1, 1, 0], [0, 1, 1]] },
  { id: "O4", shape: [[1, 1], [1, 1]] },
  { id: "F", shape: [[0, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { id: "I5", shape: [[1, 1, 1, 1, 1]] },
  { id: "L5", shape: [[1, 0], [1, 0], [1, 0], [1, 1]] },
  { id: "N", shape: [[0, 1], [0, 1], [1, 1], [1, 0]] },
  { id: "P", shape: [[1, 1], [1, 1], [1, 0]] },
  { id: "T5", shape: [[1, 1, 1], [0, 1, 0], [0, 1, 0]] },
  { id: "U", shape: [[1, 0, 1], [1, 1, 1]] },
  { id: "V5", shape: [[1, 0, 0], [1, 0, 0], [1, 1, 1]] },
  { id: "W", shape: [[1, 0, 0], [1, 1, 0], [0, 1, 1]] },
  { id: "X", shape: [[0, 1, 0], [1, 1, 1], [0, 1, 0]] },
  { id: "Y", shape: [[0, 1], [1, 1], [0, 1], [0, 1]] },
  { id: "Z5", shape: [[1, 1, 0], [0, 1, 0], [0, 1, 1]] },
];

const PIECE_BY_ID: Record<string, PieceDef> = Object.fromEntries(
  PIECES.map((p) => [p.id, p])
);

// -------------------- Shape utilities --------------------

function shapeSize(shape: Shape): number {
  let n = 0;
  for (const row of shape) for (const v of row) if (v) n++;
  return n;
}

function rotateCW(shape: Shape): Shape {
  const rows = shape.length;
  const cols = shape[0].length;
  const out: Shape = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[c][rows - 1 - r] = shape[r][c];
    }
  }
  return out;
}

function flipH(shape: Shape): Shape {
  return shape.map((row) => [...row].reverse());
}

function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.length !== b.length) return false;
  if (a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) return false;
  return true;
}

function shapeCells(shape: Shape): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) cells.push([r, c]);
  return cells;
}

function allOrientations(shape: Shape): Shape[] {
  const variants: Shape[] = [];
  let cur = shape;
  for (let i = 0; i < 4; i++) {
    if (!variants.some((s) => shapesEqual(s, cur))) variants.push(cur);
    cur = rotateCW(cur);
  }
  cur = flipH(shape);
  for (let i = 0; i < 4; i++) {
    if (!variants.some((s) => shapesEqual(s, cur))) variants.push(cur);
    cur = rotateCW(cur);
  }
  return variants;
}

// -------------------- Placement validation --------------------

function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

function validatePlacement(
  board: Board,
  color: ColorId,
  shape: Shape,
  originR: number,
  originC: number,
  isFirstMove: boolean
): { ok: boolean; reason?: string } {
  const cells: [number, number][] = [];
  for (const [dr, dc] of shapeCells(shape)) {
    const r = originR + dr;
    const c = originC + dc;
    if (!inBounds(r, c)) return { ok: false, reason: "Off the board." };
    if (board[r][c] !== 0) return { ok: false, reason: "Overlaps another piece." };
    cells.push([r, c]);
  }

  const EDGE = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [r, c] of cells) {
    for (const [dr, dc] of EDGE) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === color) {
        return { ok: false, reason: "Cannot share an edge with your own color." };
      }
    }
  }

  if (isFirstMove) {
    const [sr, sc] = START_SQUARES[color];
    if (!cells.some(([r, c]) => r === sr && c === sc)) {
      return {
        ok: false,
        reason: `${COLOR_NAME[color]}'s first piece must cover the corner (${sr + 1}, ${sc + 1}).`,
      };
    }
    return { ok: true };
  }

  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [r, c] of cells) {
    for (const [dr, dc] of DIAG) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === color) {
        return { ok: true };
      }
    }
  }
  return {
    ok: false,
    reason: "Must touch at least one diagonal corner of one of this color's pieces.",
  };
}

// -------------------- Move enumeration --------------------

function hasAnyLegalMove(
  board: Board,
  color: ColorId,
  remaining: Set<string>,
  isFirstMove: boolean
): boolean {
  const anchors: [number, number][] = [];
  if (isFirstMove) {
    anchors.push(START_SQUARES[color]);
  } else {
    const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        if (board[r][c] !== 0) continue;
        for (const [dr, dc] of DIAG) {
          const nr = r + dr;
          const nc = c + dc;
          if (inBounds(nr, nc) && board[nr][nc] === color) {
            anchors.push([r, c]);
            break;
          }
        }
      }
    }
  }
  if (anchors.length === 0) return false;

  for (const pieceId of remaining) {
    const piece = PIECE_BY_ID[pieceId];
    const orients = allOrientations(piece.shape);
    for (const shape of orients) {
      const cells = shapeCells(shape);
      for (const [ar, ac] of anchors) {
        for (const [cr, cc] of cells) {
          const originR = ar - cr;
          const originC = ac - cc;
          const v = validatePlacement(board, color, shape, originR, originC, isFirstMove);
          if (v.ok) return true;
        }
      }
    }
  }
  return false;
}

// -------------------- Scoring --------------------

function colorScore(state: GameState, color: ColorId): number {
  let leftover = 0;
  for (const id of state.remaining[color]) leftover += shapeSize(PIECE_BY_ID[id].shape);
  let s = -leftover;
  if (state.finished[color]) {
    s += 15;
    if (state.lastPlacedWasMonomino[color]) s += 5;
  }
  return s;
}

function teamScore(state: GameState, player: PlayerId): number {
  return COLORS_FOR[player].reduce((acc, c) => acc + colorScore(state, c), 0);
}

// -------------------- Initial state --------------------

function makeInitialState(): GameState {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array<Cell>(BOARD_SIZE).fill(0)
  );
  const emptySet = () => new Set(PIECES.map((p) => p.id));
  return {
    board,
    current: 1,
    remaining: { 1: emptySet(), 2: emptySet(), 3: emptySet(), 4: emptySet() },
    history: [],
    consecutivePasses: 0,
    lastPlacedWasMonomino: { 1: false, 2: false, 3: false, 4: false },
    finished: { 1: false, 2: false, 3: false, 4: false },
    passed: { 1: false, 2: false, 3: false, 4: false },
  };
}

function nextColor(c: ColorId): ColorId {
  const idx = COLOR_ORDER.indexOf(c);
  return COLOR_ORDER[(idx + 1) % COLOR_ORDER.length];
}

// -------------------- GameState serialization (for WebSocket) --------------------

function serializeState(gs: GameState): SerializedState {
  return {
    board: gs.board,
    current: gs.current,
    remaining: {
      "1": [...gs.remaining[1]],
      "2": [...gs.remaining[2]],
      "3": [...gs.remaining[3]],
      "4": [...gs.remaining[4]],
    },
    history: gs.history,
    consecutivePasses: gs.consecutivePasses,
    lastPlacedWasMonomino: gs.lastPlacedWasMonomino as Record<string, boolean>,
    finished: gs.finished as Record<string, boolean>,
    passed: gs.passed as Record<string, boolean>,
  };
}

function deserializeState(s: SerializedState): GameState {
  return {
    board: s.board as Board,
    current: s.current,
    remaining: {
      1: new Set(s.remaining["1"] ?? []),
      2: new Set(s.remaining["2"] ?? []),
      3: new Set(s.remaining["3"] ?? []),
      4: new Set(s.remaining["4"] ?? []),
    },
    history: s.history.map((h) => ({ ...h, color: h.color as ColorId })),
    consecutivePasses: s.consecutivePasses,
    lastPlacedWasMonomino: s.lastPlacedWasMonomino as Record<ColorId, boolean>,
    finished: s.finished as Record<ColorId, boolean>,
    passed: s.passed as Record<ColorId, boolean>,
  };
}

// -------------------- React component --------------------

const Blokus: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(false);
  const [state, setState] = useState<GameState>(makeInitialState);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Shape | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [message, setMessage] = useState<string>("");

  // Multiplayer state
  const socketRef = useRef<BlokusSocket | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<PlayerId | null>(null);
  const [myName, setMyName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [lobbyStatus, setLobbyStatus] = useState<"idle" | "waiting">("idle");

  // Cleanup socket on unmount.
  useEffect(() => {
    return () => { socketRef.current?.close(); };
  }, []);

  const isFirstMoveFor: Record<ColorId, boolean> = {
    1: !state.history.some((h) => h.color === 1),
    2: !state.history.some((h) => h.color === 2),
    3: !state.history.some((h) => h.color === 3),
    4: !state.history.some((h) => h.color === 4),
  };

  const allDone =
    COLOR_ORDER.every((c) => state.passed[c] || state.finished[c]) ||
    state.consecutivePasses >= 4;
  const gameOver = allDone;

  // True when it's this browser's turn to act (or if playing locally with no id assigned).
  const currentPlayer = PLAYER_FOR_COLOR[state.current];
  const isMyTurn = myPlayerId === null || currentPlayer === myPlayerId;

  useEffect(() => {
    if (selectedPieceId) {
      setOrientation(PIECE_BY_ID[selectedPieceId].shape);
    } else {
      setOrientation(null);
    }
  }, [selectedPieceId]);

  // Auto-pass any color that has no legal moves. Runs independently on both
  // clients since it's deterministic — only human moves are broadcast.
  useEffect(() => {
    if (gameOver) return;
    const c = state.current;

    if (state.remaining[c].size === 0 || state.passed[c]) {
      const t = setTimeout(() => {
        setState((s) => ({ ...s, current: nextColor(s.current) }));
      }, 250);
      return () => clearTimeout(t);
    }

    const canMove = hasAnyLegalMove(
      state.board,
      c,
      state.remaining[c],
      isFirstMoveFor[c]
    );
    if (!canMove) {
      setMessage(
        `${COLOR_NAME[c]} has no legal moves and is out for the rest of the game.`
      );
      const t = setTimeout(() => {
        setState((s) => ({
          ...s,
          passed: { ...s.passed, [c]: true },
          current: nextColor(s.current),
          consecutivePasses: s.consecutivePasses + 1,
        }));
      }, 800);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.current, state.board, gameOver]);

  function handleFindGame(name: string, preferredSide: "A" | "B") {
    setMyName(name);
    setLobbyStatus("waiting");

    const socket = new BlokusSocket();
    socketRef.current = socket;

    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "start") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        setGameStarted(true);
        setLobbyStatus("idle");
      } else if (event.type === "state") {
        setState(deserializeState(event.state));
      } else if (event.type === "opponent_disconnected") {
        setMessage("Opponent disconnected.");
      }
    };

    // Dev: Vite proxies /ws → ws://localhost:3001.
    // Prod: VITE_WS_URL is set in Vercel env vars pointing at the Railway server.
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl =
      import.meta.env.VITE_WS_URL ?? `${proto}://${window.location.host}/ws`;
    socket.connect(wsUrl, name, preferredSide);
  }

  function rotateSelected() {
    if (!orientation) return;
    setOrientation(rotateCW(orientation));
  }
  function flipSelected() {
    if (!orientation) return;
    setOrientation(flipH(orientation));
  }

  function tryPlaceAt(r: number, c: number) {
    if (gameOver || !isMyTurn || !selectedPieceId || !orientation) return;
    const color = state.current;
    if (!state.remaining[color].has(selectedPieceId)) return;

    const v = validatePlacement(
      state.board,
      color,
      orientation,
      r,
      c,
      isFirstMoveFor[color]
    );
    if (!v.ok) {
      setMessage(v.reason || "Illegal move.");
      return;
    }

    const newBoard = state.board.map((row) => [...row]) as Board;
    const placedCells: [number, number][] = [];
    for (const [dr, dc] of shapeCells(orientation)) {
      const rr = r + dr;
      const cc = c + dc;
      newBoard[rr][cc] = color;
      placedCells.push([rr, cc]);
    }

    const newRemaining = { ...state.remaining };
    newRemaining[color] = new Set(state.remaining[color]);
    newRemaining[color].delete(selectedPieceId);

    const wasMonomino = selectedPieceId === "I1";
    const finished = { ...state.finished };
    if (newRemaining[color].size === 0) finished[color] = true;

    const newState: GameState = {
      ...state,
      board: newBoard,
      remaining: newRemaining,
      history: [
        ...state.history,
        { color, pieceId: selectedPieceId, cells: placedCells },
      ],
      current: nextColor(color),
      consecutivePasses: 0,
      finished,
      lastPlacedWasMonomino: {
        ...state.lastPlacedWasMonomino,
        [color]: wasMonomino,
      },
    };

    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
  }

  function manualPass() {
    if (gameOver || !isMyTurn) return;
    const c = state.current;
    const newState: GameState = {
      ...state,
      passed: { ...state.passed, [c]: true },
      current: nextColor(state.current),
      consecutivePasses: state.consecutivePasses + 1,
    };
    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`${COLOR_NAME[c]} resigned (no more moves this game).`);
  }

  function resetGame() {
    socketRef.current?.close();
    socketRef.current = null;
    setState(makeInitialState());
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
    setMyPlayerId(null);
    setMyName("");
    setOpponentName("");
    setLobbyStatus("idle");
    setGameStarted(false);
  }

  const preview = useMemo(() => {
    if (!hover || !orientation || !selectedPieceId || gameOver || !isMyTurn) return null;
    const color = state.current;
    const cells: [number, number][] = [];
    let allInBounds = true;
    for (const [dr, dc] of shapeCells(orientation)) {
      const r = hover.r + dr;
      const c = hover.c + dc;
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
        allInBounds = false;
      }
      cells.push([r, c]);
    }
    const v = validatePlacement(
      state.board,
      color,
      orientation,
      hover.r,
      hover.c,
      isFirstMoveFor[color]
    );
    return { cells, ok: v.ok && allInBounds, color };
  }, [hover, orientation, selectedPieceId, state, gameOver, isMyTurn, isFirstMoveFor]);

  // -------------------- Rendering --------------------

  const cellSize = 26;

  const teamA = teamScore(state, "A");
  const teamB = teamScore(state, "B");

  // Resolve display names: if networked, show actual names; otherwise generic labels.
  const nameFor = (player: PlayerId): string => {
    if (!myPlayerId) return player === "A" ? "Player A (Blue + Red)" : "Player B (Yellow + Green)";
    if (player === myPlayerId) return `${myName} (${player === "A" ? "Blue + Red" : "Yellow + Green"})`;
    return `${opponentName} (${player === "A" ? "Blue + Red" : "Yellow + Green"})`;
  };

  let winnerText: string | null = null;
  if (gameOver) {
    if (teamA > teamB) winnerText = `${nameFor("A")} wins! ${teamA} to ${teamB}.`;
    else if (teamB > teamA) winnerText = `${nameFor("B")} wins! ${teamB} to ${teamA}.`;
    else winnerText = `Tie! Both teams scored ${teamA}.`;
  }

  if (!gameStarted) {
    return (
      <LobbyPage
        status={lobbyStatus}
        onFindGame={handleFindGame}
      />
    );
  }

  return (
    <div
      style={{
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        padding: 24,
        color: "#f8fafc",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
        minHeight: "100vh",
      }}
    >
      <h2 style={{ marginTop: 0 }}>Blokus — 4 colors, 2 players</h2>
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* Board */}
        <div>
          <div
            style={{
              display: "inline-block",
              padding: 4,
              background: "#0f172a",
              borderRadius: 8,
              boxShadow: "0 0 40px rgba(99, 102, 241, 0.3), 0 8px 32px rgba(0,0,0,0.6)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                gridTemplateRows: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                gap: 1,
                background: "#1e293b",
              }}
              onMouseLeave={() => setHover(null)}
            >
              {Array.from({ length: BOARD_SIZE }).map((_, r) =>
                Array.from({ length: BOARD_SIZE }).map((_, c) => {
                  const cell = state.board[r][c];
                  const startColor = (Object.keys(START_SQUARES) as unknown as ColorId[])
                    .map((k) => Number(k) as ColorId)
                    .find(
                      (col) =>
                        START_SQUARES[col][0] === r && START_SQUARES[col][1] === c
                    );

                  let bg = cell ? COLOR_HEX[cell] : "#ffffff";
                  let outline = "none";
                  if (preview) {
                    const inPreview = preview.cells.some(
                      ([pr, pc]) => pr === r && pc === c
                    );
                    if (inPreview) {
                      bg = preview.ok
                        ? COLOR_LIGHT[preview.color]
                        : "#fde2e2";
                      outline = preview.ok
                        ? `2px solid ${COLOR_HEX[preview.color]}`
                        : "2px solid #dc2626";
                    }
                  }

                  return (
                    <div
                      key={`${r}-${c}`}
                      onMouseEnter={() => setHover({ r, c })}
                      onClick={() => tryPlaceAt(r, c)}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: bg,
                        outline,
                        outlineOffset: -2,
                        cursor: selectedPieceId && isMyTurn ? "pointer" : "default",
                        position: "relative",
                      }}
                    >
                      {startColor && cell === 0 && (
                        <div
                          style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: COLOR_HEX[startColor],
                            opacity: 0.6,
                            fontSize: 16,
                            pointerEvents: "none",
                          }}
                        >
                          ●
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {message && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: "#fef3c7",
                border: "1px solid #fde68a",
                borderRadius: 4,
                display: "inline-block",
                color: "#78350f",
              }}
            >
              {message}
            </div>
          )}

          {gameOver && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: "#dcfce7",
                border: "1px solid #86efac",
                borderRadius: 6,
                color: "#14532d",
              }}
            >
              <strong>Game over.</strong> {winnerText}
              <div style={{ marginTop: 8 }}>
                <button onClick={resetGame} style={btn()}>
                  Play again
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div style={{ minWidth: 360, maxWidth: 520 }}>
          <ScorePanel state={state} teamA={teamA} teamB={teamB} nameFor={nameFor} />

          {!gameOver && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: `2px solid ${COLOR_HEX[state.current]}`,
                borderRadius: 6,
                background: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(8px)",
                boxShadow: `0 0 20px ${COLOR_HEX[state.current]}33`,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {isMyTurn
                  ? `Your turn — ${nameFor(currentPlayer)}`
                  : `Waiting for ${nameFor(currentPlayer)}…`}
              </div>
              <div style={{ marginBottom: 6, color: "#94a3b8", fontSize: 14 }}>
                Now playing:{" "}
                <span
                  style={{
                    background: COLOR_HEX[state.current],
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 3,
                    fontWeight: 600,
                  }}
                >
                  {COLOR_NAME[state.current]}
                </span>
              </div>
              {isFirstMoveFor[state.current] ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  First {COLOR_NAME[state.current]} move: piece must cover corner (
                  {START_SQUARES[state.current][0] + 1},{" "}
                  {START_SQUARES[state.current][1] + 1}).
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  Must touch a diagonal corner of an existing{" "}
                  {COLOR_NAME[state.current]} piece, with no shared edges.
                </div>
              )}

              {isMyTurn && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button onClick={rotateSelected} disabled={!orientation} style={btn()}>
                    Rotate ⟳
                  </button>
                  <button onClick={flipSelected} disabled={!orientation} style={btn()}>
                    Flip ⇋
                  </button>
                  <button
                    onClick={() => setSelectedPieceId(null)}
                    disabled={!selectedPieceId}
                    style={btn()}
                  >
                    Deselect
                  </button>
                  <button onClick={manualPass} style={btn("warn")}>
                    Resign {COLOR_NAME[state.current]}
                  </button>
                  <button onClick={resetGame} style={btn("ghost")}>
                    Quit
                  </button>
                </div>
              )}

              {!isMyTurn && (
                <button onClick={resetGame} style={{ ...btn("ghost"), marginTop: 10 }}>
                  Quit
                </button>
              )}

              {orientation && isMyTurn && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    Click a board cell to place — that cell becomes the piece's
                    top-left corner:
                  </div>
                  <ShapePreview
                    shape={orientation}
                    color={COLOR_HEX[state.current]}
                    cellPx={20}
                  />
                </div>
              )}
            </div>
          )}

          <PieceTray
            color={state.current}
            remaining={state.remaining}
            selectedPieceId={selectedPieceId}
            onPick={(id) => setSelectedPieceId(id)}
            disabled={gameOver || !isMyTurn}
          />
        </div>
      </div>

      <RulesFooter />
    </div>
  );
};

// -------------------- Subcomponents --------------------

const ScorePanel: React.FC<{
  state: GameState;
  teamA: number;
  teamB: number;
  nameFor: (p: PlayerId) => string;
}> = ({ state, teamA, teamB, nameFor }) => {
  const colorRow = (c: ColorId) => (
    <div
      key={c}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "4px 8px",
        background: state.current === c ? COLOR_LIGHT[c] : "rgba(255,255,255,0.08)",
        border: `1px solid ${COLOR_HEX[c]}`,
        borderRadius: 4,
        marginBottom: 4,
        opacity: state.passed[c] ? 0.6 : 1,
        color: state.current === c ? "#0f172a" : "#f8fafc",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-block",
            width: 12,
            height: 12,
            background: COLOR_HEX[c],
            borderRadius: 2,
          }}
        />
        <strong>{COLOR_NAME[c]}</strong>
        {state.passed[c] && (
          <span style={{ fontSize: 11, color: "#94a3b8" }}>(out)</span>
        )}
        {state.finished[c] && (
          <span style={{ fontSize: 11, color: "#16a34a" }}>(done!)</span>
        )}
      </div>
      <div style={{ fontSize: 12 }}>
        Left: {state.remaining[c].size} • Score: {colorScore(state, c)}
      </div>
    </div>
  );

  const teamBlock = (player: PlayerId, total: number) => (
    <div
      style={{
        padding: 8,
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 6,
        background: "rgba(255,255,255,0.06)",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <strong style={{ fontSize: 13 }}>{nameFor(player)}</strong>
        <span>Total: {total}</span>
      </div>
      {COLORS_FOR[player].map(colorRow)}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {teamBlock("A", teamA)}
      {teamBlock("B", teamB)}
    </div>
  );
};

const PieceTray: React.FC<{
  color: ColorId;
  remaining: Record<ColorId, Set<string>>;
  selectedPieceId: string | null;
  onPick: (id: string) => void;
  disabled: boolean;
}> = ({ color, remaining, selectedPieceId, onPick, disabled }) => {
  return (
    <div style={{ marginTop: 12 }}>
      <h4 style={{ margin: "8px 0" }}>
        {COLOR_NAME[color]}'s remaining pieces
      </h4>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))",
          gap: 6,
        }}
      >
        {PIECES.map((p) => {
          const available = remaining[color].has(p.id);
          const selected = selectedPieceId === p.id;
          return (
            <button
              key={p.id}
              disabled={disabled || !available}
              onClick={() => onPick(p.id)}
              style={{
                padding: 4,
                border: selected
                  ? `2px solid ${COLOR_HEX[color]}`
                  : "1px solid rgba(255,255,255,0.12)",
                background: available ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)",
                opacity: available ? 1 : 0.4,
                borderRadius: 4,
                cursor: available && !disabled ? "pointer" : "not-allowed",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
              title={p.id}
            >
              <ShapePreview
                shape={p.shape}
                color={COLOR_HEX[color]}
                cellPx={9}
                muted={!available}
              />
              <span style={{ fontSize: 10, color: "#94a3b8" }}>{p.id}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const ShapePreview: React.FC<{
  shape: Shape;
  color: string;
  cellPx: number;
  muted?: boolean;
}> = ({ shape, color, cellPx, muted }) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${shape[0].length}, ${cellPx}px)`,
        gridTemplateRows: `repeat(${shape.length}, ${cellPx}px)`,
        gap: 1,
      }}
    >
      {shape.flatMap((row, r) =>
        row.map((v, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              width: cellPx,
              height: cellPx,
              background: v ? (muted ? "#cbd5e1" : color) : "transparent",
              border: v ? "1px solid rgba(0,0,0,0.1)" : "none",
            }}
          />
        ))
      )}
    </div>
  );
};

const RulesFooter: React.FC = () => (
  <details style={{ marginTop: 24, maxWidth: 760 }}>
    <summary style={{ cursor: "pointer", fontWeight: 600 }}>Rules</summary>
    <ol style={{ lineHeight: 1.6 }}>
      <li>
        Four colors play in clockwise order: Blue → Yellow → Red → Green. Two
        players share them — Player A controls Blue and Red (diagonally
        opposite corners), Player B controls Yellow and Green.
      </li>
      <li>Each color's first piece must cover its starting corner.</li>
      <li>
        Every later piece of a color must touch at least one diagonal corner of
        one of that same color's earlier pieces, and may never share a flat
        edge with another piece of the same color. Edges may freely touch any
        of the other three colors (including your own other color).
      </li>
      <li>Use Rotate / Flip to reorient the selected piece before placing.</li>
      <li>
        If a color has no legal moves, it sits out the rest of the game
        automatically. The game ends when all four colors are out or finished.
      </li>
      <li>
        Per-color score = -(squares of unplaced pieces). +15 for placing all 21
        pieces, plus +5 if the very last piece placed by that color was the
        single square (I1). A player's team score is the sum of their two
        colors' scores.
      </li>
    </ol>
  </details>
);

// -------------------- Style helpers --------------------

function btn(variant: "primary" | "warn" | "ghost" = "primary"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 4,
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    color: "#f8fafc",
    cursor: "pointer",
    fontSize: 13,
  };
  if (variant === "warn") {
    base.background = "rgba(245,158,11,0.2)";
    base.borderColor = "#f59e0b";
    base.color = "#fde68a";
  } else if (variant === "ghost") {
    base.background = "transparent";
    base.color = "#94a3b8";
    base.border = "1px solid transparent";
  }
  return base;
}

// -------------------- Lobby --------------------

const LOBBY_BG: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#f8fafc",
  gap: 40,
  padding: 24,
  boxSizing: "border-box",
};

const CARD_STYLE: React.CSSProperties = {
  width: "100%",
  maxWidth: 480,
  padding: "32px 28px",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 16,
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(8px)",
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const LobbyPage: React.FC<{
  status: "idle" | "waiting";
  onFindGame: (name: string, preferredSide: "A" | "B") => void;
}> = ({ status, onFindGame }) => {
  const [step, setStep] = useState<"name" | "team">("name");
  const [name, setName] = useState("");
  const [side, setSide] = useState<"A" | "B" | null>(null);

  const advanceToTeam = () => {
    if (name.trim().length > 0) setStep("team");
  };

  const canFind = side !== null && status === "idle";

  // ---------- Step 1: name ----------
  if (step === "name") {
    return (
      <div style={LOBBY_BG}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>
            BLOKUS
          </h1>
          <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
            4 colors · classic rules
          </p>
        </div>

        <div style={CARD_STYLE}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ fontSize: 13, color: "#94a3b8" }}>Your name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim().length > 0 && advanceToTeam()}
              placeholder="Enter your name…"
              maxLength={24}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(255,255,255,0.08)",
                color: "#f8fafc",
                fontSize: 16,
                outline: "none",
              }}
            />
          </div>

          <button
            disabled={name.trim().length === 0}
            onClick={advanceToTeam}
            style={{
              padding: "14px 0",
              fontSize: 16,
              fontWeight: 700,
              borderRadius: 10,
              border: "none",
              background:
                name.trim().length > 0
                  ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                  : "rgba(255,255,255,0.08)",
              color: name.trim().length > 0 ? "#fff" : "#475569",
              cursor: name.trim().length > 0 ? "pointer" : "not-allowed",
              boxShadow:
                name.trim().length > 0 ? "0 0 32px rgba(99,102,241,0.5)" : "none",
              letterSpacing: 1,
            }}
          >
            Continue →
          </button>
        </div>
      </div>
    );
  }

  // ---------- Step 2: team select ----------
  const teamCard = (
    player: "A" | "B",
    colors: ColorId[],
    label: string,
    gradient: string
  ) => {
    const selected = side === player;
    return (
      <button
        key={player}
        onClick={() => setSide(player)}
        style={{
          flex: 1,
          padding: "24px 16px",
          borderRadius: 12,
          border: selected
            ? `2px solid transparent`
            : "2px solid rgba(255,255,255,0.12)",
          background: selected
            ? gradient
            : "rgba(255,255,255,0.05)",
          backgroundClip: selected ? undefined : undefined,
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          boxShadow: selected ? "0 0 28px rgba(99,102,241,0.35)" : "none",
          transition: "all 0.15s ease",
          outline: "none",
          position: "relative",
        }}
      >
        {selected && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 10,
              border: "2px solid rgba(255,255,255,0.5)",
              pointerEvents: "none",
            }}
          />
        )}
        {/* Color swatches */}
        <div style={{ display: "flex", gap: 8 }}>
          {colors.map((c) => (
            <div
              key={c}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                background: COLOR_HEX[c],
                boxShadow: `0 2px 8px ${COLOR_HEX[c]}88`,
              }}
            />
          ))}
        </div>
        <div style={{ fontWeight: 700, fontSize: 15, color: "#f8fafc" }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          {colors.map((c) => COLOR_NAME[c]).join(" + ")}
        </div>
      </button>
    );
  };

  return (
    <div style={LOBBY_BG}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>
          BLOKUS
        </h1>
        <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
          Hi <strong style={{ color: "#f8fafc" }}>{name}</strong>! Pick your side.
        </p>
      </div>

      <div style={{ ...CARD_STYLE, maxWidth: 520 }}>
        {/* Team cards */}
        <div style={{ display: "flex", gap: 16 }}>
          {teamCard("A", [1, 3], "Team A", "linear-gradient(135deg, #1d4ed888, #dc262688)")}
          {teamCard("B", [2, 4], "Team B", "linear-gradient(135deg, #a1620088, #15803d88)")}
        </div>

        {status === "waiting" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 8,
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.4)",
              fontSize: 14,
              color: "#a5b4fc",
            }}
          >
            <Spinner />
            Waiting for an opponent…
          </div>
        )}

        <button
          disabled={!canFind}
          onClick={() => side && onFindGame(name.trim(), side)}
          style={{
            padding: "14px 0",
            fontSize: 16,
            fontWeight: 700,
            borderRadius: 10,
            border: "none",
            background: canFind
              ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
              : "rgba(255,255,255,0.08)",
            color: canFind ? "#fff" : "#475569",
            cursor: canFind ? "pointer" : "not-allowed",
            boxShadow: canFind ? "0 0 32px rgba(99,102,241,0.5)" : "none",
            letterSpacing: 1,
          }}
        >
          Find Game
        </button>

        <button
          onClick={() => setStep("name")}
          style={{ ...btn("ghost"), alignSelf: "center", fontSize: 13 }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
};

const Spinner: React.FC = () => (
  <div
    style={{
      width: 16,
      height: 16,
      border: "2px solid rgba(165,180,252,0.3)",
      borderTopColor: "#a5b4fc",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      flexShrink: 0,
    }}
  >
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

export default Blokus;
