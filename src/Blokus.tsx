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

// Blue + Red share the bottom edge (Player A's home side).
// Yellow + Green share the top edge (Player B's home side — they see the board rotated 180°).
const START_SQUARES: Record<ColorId, [number, number]> = {
  1: [BOARD_SIZE - 1, 0],              // Blue:   bottom-left
  2: [0, BOARD_SIZE - 1],              // Yellow: top-right  (bottom-left from B's rotated view)
  3: [BOARD_SIZE - 1, BOARD_SIZE - 1], // Red:    bottom-right
  4: [0, 0],                           // Green:  top-left   (bottom-right from B's rotated view)
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

// Score = squares remaining (lower is better). Bonuses subtract for placing all pieces.
function colorScore(state: GameState, color: ColorId): number {
  let leftover = 0;
  for (const id of state.remaining[color]) leftover += shapeSize(PIECE_BY_ID[id].shape);
  if (state.finished[color]) {
    leftover -= 15;
    if (state.lastPlacedWasMonomino[color]) leftover -= 5;
  }
  return leftover;
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

const DEV_SKIP = new URLSearchParams(window.location.search).has("dev");

const Blokus: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(DEV_SKIP);
  const [state, setState] = useState<GameState>(makeInitialState);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Shape | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [message, setMessage] = useState<string>("");
  const [gameOverDismissed, setGameOverDismissed] = useState(false);
  const [rematchWaiting, setRematchWaiting] = useState(false);
  const [lobbyCode, setLobbyCode] = useState<string | null>(null);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [submitFeedback, setSubmitFeedback] = useState<"illegal" | null>(null);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(null);
  const [opponentAbandoned, setOpponentAbandoned] = useState(false);

  // Multiplayer state
  const socketRef = useRef<BlokusSocket | null>(null);
  const boardGridRef = useRef<HTMLDivElement>(null);
  const selectedPieceIdRef = useRef(selectedPieceId);
  const [myPlayerId, setMyPlayerId] = useState<PlayerId | null>(null);
  const [myName, setMyName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [lobbyStatus, setLobbyStatus] = useState<"idle" | "waiting">("idle");

  // Cleanup socket on unmount.
  useEffect(() => {
    return () => { socketRef.current?.close(); };
  }, []);

  // Countdown tick when opponent disconnects.
  useEffect(() => {
    if (disconnectCountdown === null) return;
    if (disconnectCountdown <= 0) {
      setDisconnectCountdown(null);
      setOpponentAbandoned(true);
      setGameOverDismissed(false);
      return;
    }
    const t = setTimeout(() => setDisconnectCountdown((d) => (d !== null ? d - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [disconnectCountdown]);

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

  // The next color belonging to this player that will get to play.
  const nextUpColor: ColorId | null = useMemo(() => {
    if (!myPlayerId) return null;
    const mine = COLORS_FOR[myPlayerId];
    let idx = COLOR_ORDER.indexOf(state.current);
    for (let i = 1; i <= 4; i++) {
      const c = COLOR_ORDER[(idx + i) % 4] as ColorId;
      if (mine.includes(c) && !state.passed[c] && !state.finished[c]) return c;
    }
    return null;
  }, [myPlayerId, state.current, state.passed, state.finished]);

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
        setRematchWaiting(false);
        setMessage("");
      } else if (event.type === "rejoined") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        if (event.state) setState(deserializeState(event.state));
        setGameStarted(true);
        setLobbyStatus("idle");
        setRematchWaiting(false);
        setMessage("Reconnected!");
      } else if (event.type === "state") {
        setState(deserializeState(event.state));
      } else if (event.type === "reconnecting") {
        setMessage("Connection lost — reconnecting…");
      } else if (event.type === "opponent_reconnected") {
        setDisconnectCountdown(null);
        setMessage("Opponent reconnected!");
      } else if (event.type === "opponent_disconnected") {
        setDisconnectCountdown(60);
      }
    };

    // Dev: Vite proxies /ws → ws://localhost:3001.
    // Prod: VITE_WS_URL is set in Vercel env vars pointing at the Railway server.
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl =
      import.meta.env.VITE_WS_URL ?? `${proto}://${window.location.host}/ws`;
    socket.connect(wsUrl, name, preferredSide);
  }

  function handleCreateLobby(name: string, preferredSide: "A" | "B") {
    setMyName(name);
    setLobbyStatus("waiting");
    setLobbyCode(null);
    setLobbyError(null);
    const socket = new BlokusSocket();
    socketRef.current = socket;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = import.meta.env.VITE_WS_URL ?? `${proto}://${window.location.host}/ws`;
    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "lobby_created") {
        setLobbyCode(event.code);
      } else if (event.type === "start") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        setGameStarted(true);
        setLobbyStatus("idle");
        setLobbyCode(null);
        setRematchWaiting(false);
        setMessage("");
      } else if (event.type === "state") {
        setState(deserializeState(event.state));
      } else if (event.type === "opponent_disconnected") {
        setDisconnectCountdown(60);
      }
    };
    socket.createLobby(wsUrl, name, preferredSide);
  }

  function handleJoinLobby(name: string, code: string) {
    setMyName(name);
    setLobbyStatus("waiting");
    setLobbyCode(null);
    setLobbyError(null);
    const socket = new BlokusSocket();
    socketRef.current = socket;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = import.meta.env.VITE_WS_URL ?? `${proto}://${window.location.host}/ws`;
    socket.onEvent = (event: ServerEvent) => {
      if (event.type === "start") {
        setMyPlayerId(event.playerId as PlayerId);
        setOpponentName(event.opponentName);
        setGameStarted(true);
        setLobbyStatus("idle");
        setRematchWaiting(false);
        setMessage("");
      } else if (event.type === "lobby_not_found") {
        setLobbyError("Game code not found. Check the code and try again.");
        setLobbyStatus("idle");
      } else if (event.type === "state") {
        setState(deserializeState(event.state));
      } else if (event.type === "opponent_disconnected") {
        setDisconnectCountdown(60);
      }
    };
    socket.joinLobby(wsUrl, name, code);
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

  function skipTurn() {
    if (gameOver || !isMyTurn) return;
    const c = state.current;
    const newState: GameState = {
      ...state,
      current: nextColor(state.current),
      consecutivePasses: state.consecutivePasses + 1,
    };
    setState(newState);
    socketRef.current?.sendMove(serializeState(newState));
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`${COLOR_NAME[c]} skipped their turn.`);
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
    setGameOverDismissed(false);
    setRematchWaiting(false);
    setLobbyCode(null);
    setLobbyError(null);
    setDisconnectCountdown(null);
    setOpponentAbandoned(false);
  }

  function handleRematch() {
    const nextSide: PlayerId = myPlayerId === "A" ? "B" : "A";
    const name = myName;
    socketRef.current?.close();
    socketRef.current = null;
    setState(makeInitialState());
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
    setGameOverDismissed(false);
    setMyPlayerId(null);
    setOpponentName("");
    setGameStarted(false);
    setRematchWaiting(true);
    setLobbyCode(null);
    setLobbyError(null);
    setDisconnectCountdown(null);
    setOpponentAbandoned(false);
    handleFindGame(name, nextSide);
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

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const isMobile = windowWidth < 600;

  // Keep ref fresh so touch handlers don't capture stale selectedPieceId.
  selectedPieceIdRef.current = selectedPieceId;

  // Non-passive touch listeners so we can preventDefault (stops page scroll while dragging a piece).
  useEffect(() => {
    if (!isMobile) return;
    const el = boardGridRef.current;
    if (!el) return;

    const getCell = (touch: Touch) => {
      const rect = el.getBoundingClientRect();
      let relX = touch.clientX - rect.left;
      let relY = touch.clientY - rect.top;
      if (myPlayerId === "B") {
        relX = rect.width - relX;
        relY = rect.height - relY;
      }
      const cellPluGap = rect.width / BOARD_SIZE;
      return {
        r: Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(relY / cellPluGap))),
        c: Math.max(0, Math.min(BOARD_SIZE - 1, Math.floor(relX / cellPluGap))),
      };
    };

    const handler = (e: TouchEvent) => {
      if (!selectedPieceIdRef.current) return;
      e.preventDefault();
      setHover(getCell(e.touches[0]));
    };

    el.addEventListener("touchstart", handler, { passive: false });
    el.addEventListener("touchmove", handler, { passive: false });
    return () => {
      el.removeEventListener("touchstart", handler);
      el.removeEventListener("touchmove", handler);
    };
  }, [isMobile, myPlayerId]);
  // Board occupies ~46% of viewport on desktop; panel gets the rest (up to 700px).
  // Mobile: fill available width (outer padding 48px + board card padding 8px + 19 gaps = 75px overhead).
  // Desktop: board takes ~46% of viewport.
  const cellSize = isMobile
    ? Math.max(11, Math.floor((windowWidth - 75) / BOARD_SIZE))
    : Math.min(34, Math.max(18, Math.floor((windowWidth * 0.46 - 32) / BOARD_SIZE)));

  // Derive tray cell size from actual available panel width.
  const boardPx = cellSize * BOARD_SIZE + 20 + 8;
  const containerW = Math.min(1600, windowWidth) - 48;
  const panelW = isMobile
    ? containerW
    : Math.min(700, Math.max(380, containerW - boardPx - 20));
  const trayW = (panelW - 8) / 2;
  const trayCellPx = Math.max(8, Math.min(14, Math.floor(trayW / 26)));

  const teamA = teamScore(state, "A");
  const teamB = teamScore(state, "B");

  // Resolve display names: if networked, show actual names; otherwise generic labels.
  const nameFor = (player: PlayerId): string => {
    if (!myPlayerId) return player === "A" ? "Player A" : "Player B";
    return player === myPlayerId ? myName : opponentName;
  };

  let winnerText: string | null = null;
  if (opponentAbandoned) {
    winnerText = `${opponentName || "Opponent"} left the game.`;
  } else if (gameOver) {
    if (teamA < teamB) winnerText = `${nameFor("A")} wins! ${teamA} to ${teamB}.`;
    else if (teamB < teamA) winnerText = `${nameFor("B")} wins! ${teamB} to ${teamA}.`;
    else winnerText = `Tie! Both teams scored ${teamA}.`;
  }

  if (!gameStarted) {
    if (rematchWaiting) {
      return (
        <div style={{ ...LOBBY_BG, gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>BLOKUS BESTIES</h1>
          <div style={{ ...CARD_STYLE, alignItems: "center", textAlign: "center" }}>
            <Spinner />
            <p style={{ margin: 0, color: "#94a3b8", fontSize: 15 }}>
              Waiting for {opponentName || "opponent"} to rematch…
            </p>
            <button onClick={resetGame} style={{ ...btn("ghost"), fontSize: 13 }}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <LobbyPage
        status={lobbyStatus}
        onFindGame={handleFindGame}
        onCreateLobby={handleCreateLobby}
        onJoinLobby={handleJoinLobby}
        lobbyCode={lobbyCode}
        lobbyError={lobbyError}
        onClearError={() => setLobbyError(null)}
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
        background: "linear-gradient(135deg, #0d1117 0%, #1f0d14 50%, #0d1117 100%)",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          gap: 20,
          alignItems: "flex-start",
          flexDirection: isMobile ? "column" : "row",
        }}
      >
        {/* Board */}
        <div style={isMobile ? { display: "flex", justifyContent: "center", width: "100%" } : undefined}>
          <div
            style={{
              display: "inline-block",
              padding: 4,
              background: "#0d1117",
              borderRadius: 8,
              boxShadow: "0 0 40px rgba(16, 185, 129, 0.25), 0 8px 32px rgba(0,0,0,0.6)",
            }}
          >
            <div
              ref={boardGridRef}
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                gridTemplateRows: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
                gap: 1,
                background: "#161b22",
                transform: myPlayerId === "B" ? "rotate(180deg)" : undefined,
              }}
              onMouseLeave={() => setHover(null)}
            >
              {(() => {
                const lastMove = state.history.length > 0 ? state.history[state.history.length - 1] : null;
                const lastMoveCellSet = lastMove
                  ? new Set(lastMove.cells.map(([r, c]) => `${r}-${c}`))
                  : new Set<string>();
                return Array.from({ length: BOARD_SIZE }).map((_, r) =>
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
                  let boxShadow: string | undefined;
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
                  } else if (lastMove && lastMoveCellSet.has(`${r}-${c}`)) {
                    boxShadow = `inset 0 0 0 2px white, inset 0 0 0 3px ${COLOR_HEX[lastMove.color]}, 0 0 6px 2px ${COLOR_HEX[lastMove.color]}`;
                  }

                  return (
                    <div
                      key={`${r}-${c}`}
                      onMouseEnter={() => setHover({ r, c })}
                      onClick={isMobile ? undefined : () => tryPlaceAt(r, c)}
                      style={{
                        width: cellSize,
                        height: cellSize,
                        background: bg,
                        outline,
                        outlineOffset: -2,
                        boxShadow,
                        cursor: selectedPieceId && isMyTurn ? "pointer" : "default",
                        position: "relative",
                        zIndex: boxShadow ? 1 : undefined,
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
              );
              })()}
            </div>
          </div>


        </div>

        {/* Side panel */}
        <div style={{ width: isMobile ? "100%" : undefined, minWidth: isMobile ? 0 : 380, maxWidth: isMobile ? "100%" : 700 }}>
          <ScorePanel state={state} teamA={teamA} teamB={teamB} nameFor={nameFor} gameOver={gameOver} />

          {gameOver && gameOverDismissed && (
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => setGameOverDismissed(false)} style={{ ...btn(), flex: 1 }}>
                View results
              </button>
              <button onClick={handleRematch} style={{ ...btn("warn"), flex: 1 }}>
                Play again
              </button>
            </div>
          )}

          {message && <GameMessage message={message} />}

          {disconnectCountdown !== null && (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(245,158,11,0.15)", border: "1px solid #f59e0b", borderRadius: 8, color: "#fde68a", fontSize: 13, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>Opponent disconnected</span>
              <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 15, fontWeight: 800 }}>{disconnectCountdown}s</span>
            </div>
          )}

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
                  ? `Your turn: ${nameFor(currentPlayer)}`
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
                  <button onClick={skipTurn} style={btn()}>
                    Skip turn
                  </button>
                  <button onClick={manualPass} style={btn("warn")}>
                    Resign {COLOR_NAME[state.current]}
                  </button>
                </div>
              )}

              {orientation && isMyTurn && isMobile && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>
                    Drag on the board to position, then tap Place:
                  </div>
                  {submitFeedback === "illegal" && (
                    <div style={{
                      padding: "8px 12px",
                      background: "rgba(220,38,38,0.2)",
                      border: "1px solid #dc2626",
                      borderRadius: 6,
                      color: "#fca5a5",
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "center",
                    }}>
                      That's illegal!
                    </div>
                  )}
                  <button
                    disabled={!hover}
                    onClick={() => {
                      if (!hover || !orientation) return;
                      const color = state.current;
                      const v = validatePlacement(state.board, color, orientation, hover.r, hover.c, isFirstMoveFor[color]);
                      if (v.ok) {
                        tryPlaceAt(hover.r, hover.c);
                        setSubmitFeedback(null);
                      } else {
                        setSubmitFeedback("illegal");
                        setTimeout(() => setSubmitFeedback(null), 2000);
                      }
                    }}
                    style={{
                      padding: "12px 0",
                      fontSize: 15,
                      fontWeight: 700,
                      borderRadius: 8,
                      border: "none",
                      background: hover ? `linear-gradient(135deg, ${COLOR_HEX[state.current]}, ${COLOR_HEX[state.current]}99)` : "rgba(255,255,255,0.08)",
                      color: hover ? "#fff" : "#475569",
                      cursor: hover ? "pointer" : "not-allowed",
                      boxShadow: hover ? `0 0 20px ${COLOR_HEX[state.current]}55` : "none",
                    }}
                  >
                    Place Piece
                  </button>
                </div>
              )}

              {orientation && isMyTurn && !isMobile && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    Click a board cell to place — that cell becomes the piece's
                    top-left corner:
                  </div>
                  <div style={{ transform: myPlayerId === "B" ? "rotate(180deg)" : undefined, display: "inline-block" }}>
                    <ShapePreview
                      shape={orientation}
                      color={COLOR_HEX[state.current]}
                      cellPx={20}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {!gameOver && (
            <div style={{ display: "flex", flexDirection: "row", gap: 8, marginTop: 12 }}>
              {(myPlayerId ? COLORS_FOR[myPlayerId] : [state.current]).map((color) => {
                const isActive = isMyTurn && color === state.current;
                const isNext = !isActive && color === nextUpColor;
                return (
                  <div
                    key={color}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: isActive
                        ? `2px solid ${COLOR_HEX[color]}`
                        : `1px solid rgba(255,255,255,0.1)`,
                      borderRadius: 8,
                      padding: "8px 8px 6px",
                      background: isActive ? `${COLOR_HEX[color]}11` : "rgba(255,255,255,0.02)",
                      boxShadow: isActive ? `0 0 20px ${COLOR_HEX[color]}33` : "none",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <span
                        style={{
                          width: 9, height: 9, borderRadius: 2,
                          background: COLOR_HEX[color], flexShrink: 0,
                        }}
                      />
                      <strong style={{ fontSize: 12 }}>{COLOR_NAME[color]}</strong>
                      <span style={{ fontSize: 10, color: "#64748b" }}>
                        {state.remaining[color].size} left
                      </span>
                      {isActive && (
                        <span style={{
                          marginLeft: "auto", fontSize: 10, fontWeight: 700,
                          background: COLOR_HEX[color], color: "#fff",
                          padding: "1px 6px", borderRadius: 10,
                        }}>
                          Playing
                        </span>
                      )}
                      {isNext && (
                        <span style={{
                          marginLeft: "auto", fontSize: 10,
                          color: "#94a3b8", padding: "1px 6px", borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.15)",
                        }}>
                          Up next
                        </span>
                      )}
                    </div>
                    <PieceTray
                      color={color}
                      remaining={state.remaining}
                      selectedPieceId={isActive ? selectedPieceId : null}
                      onPick={isActive ? (id) => setSelectedPieceId(id) : () => {}}
                      disabled={!isActive}
                      hideTitle
                      cellPx={trayCellPx}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Game-over modal */}
      {(gameOver || opponentAbandoned) && !gameOverDismissed && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 24,
          }}
        >
          <div
            style={{
              background: "linear-gradient(160deg, #1f0d14 0%, #0d1117 100%)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 20,
              padding: "40px 36px",
              maxWidth: 420,
              width: "100%",
              textAlign: "center",
              boxShadow: "0 0 80px rgba(236,72,153,0.3), 0 24px 64px rgba(0,0,0,0.7)",
              position: "relative",
            }}
          >
            <button
              onClick={() => setGameOverDismissed(true)}
              style={{
                position: "absolute",
                top: 12,
                right: 14,
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 22,
                cursor: "pointer",
                lineHeight: 1,
                padding: 4,
              }}
              aria-label="Close"
            >
              ×
            </button>
            <div style={{ fontSize: 56, marginBottom: 12 }}>
              {opponentAbandoned ? "🚪" : teamA < teamB ? "🏆" : teamB < teamA ? "🏆" : "🤝"}
            </div>
            <h2 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>
              {opponentAbandoned ? "Opponent Left" : "Game Over"}
            </h2>
            <p style={{ margin: "0 0 28px", color: "#f9a8d4", fontSize: 16 }}>
              {winnerText}
            </p>

            {/* Score reveal */}
            <div style={{ display: "flex", gap: 12, marginBottom: 28 }}>
              {(["A", "B"] as PlayerId[]).map((player) => {
                const score = player === "A" ? teamA : teamB;
                const isWinner = (player === "A" && teamA < teamB) || (player === "B" && teamB < teamA);
                return (
                  <div
                    key={player}
                    style={{
                      flex: 1,
                      padding: "14px 12px",
                      borderRadius: 12,
                      border: isWinner
                        ? "1px solid rgba(236,72,153,0.6)"
                        : "1px solid rgba(255,255,255,0.1)",
                      background: isWinner
                        ? "rgba(236,72,153,0.15)"
                        : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 4 }}>
                      {nameFor(player)}
                    </div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: isWinner ? "#f9a8d4" : "#f8fafc" }}>
                      {score}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>points remaining</div>
                    {COLORS_FOR[player].map((c) => (
                      <div key={c} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: COLOR_HEX[c], display: "inline-block" }} />
                          {COLOR_NAME[c]}
                        </span>
                        <span style={{ fontSize: 12, color: "#94a3b8" }}>{colorScore(state, c)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <button
              onClick={handleRematch}
              style={{
                width: "100%",
                padding: "14px 0",
                fontSize: 16,
                fontWeight: 700,
                borderRadius: 10,
                border: "none",
                background: "linear-gradient(135deg, #ec4899, #be185d)",
                color: "#fff",
                cursor: "pointer",
                boxShadow: "0 0 32px rgba(236,72,153,0.5)",
                letterSpacing: 1,
              }}
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// -------------------- Subcomponents --------------------

const GameMessage: React.FC<{ message: string }> = ({ message }) => {
  const isError = /illegal|cannot|must|off the board|overlaps/i.test(message);
  const isSuccess = /reconnected/i.test(message);
  const isWarning = /disconnected|reconnecting|resigned|no legal moves|skipped/i.test(message);

  const colors = isError
    ? { bg: "rgba(220,38,38,0.15)", border: "#dc2626", text: "#fca5a5" }
    : isSuccess
    ? { bg: "rgba(22,163,74,0.15)", border: "#16a34a", text: "#86efac" }
    : isWarning
    ? { bg: "rgba(245,158,11,0.15)", border: "#f59e0b", text: "#fde68a" }
    : { bg: "rgba(99,102,241,0.15)", border: "#6366f1", text: "#c7d2fe" };

  return (
    <div
      style={{
        marginTop: 8,
        padding: "10px 14px",
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        color: colors.text,
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
};

const ScorePanel: React.FC<{
  state: GameState;
  teamA: number;
  teamB: number;
  nameFor: (p: PlayerId) => string;
  gameOver: boolean;
}> = ({ state, teamA, teamB, nameFor, gameOver }) => {
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
        color: state.current === c ? "#0d1117" : "#f8fafc",
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
      <div style={{ fontSize: 12, whiteSpace: "nowrap" }}>
        {gameOver
          ? `${state.remaining[c].size} left • Score: ${colorScore(state, c)}`
          : `${state.remaining[c].size} left`}
      </div>
    </div>
  );

  const teamBlock = (player: PlayerId, total: number) => (
    <div
      style={{
        flex: 1,
        minWidth: 0,
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
        {gameOver && <span>Total: {total}</span>}
      </div>
      {COLORS_FOR[player].map(colorRow)}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
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
  hideTitle?: boolean;
  cellPx?: number;
}> = ({ color, remaining, selectedPieceId, onPick, disabled, hideTitle, cellPx = 9 }) => {
  const minCell = 5 * cellPx + 14;
  return (
    <div style={{ marginTop: hideTitle ? 0 : 12 }}>
      {!hideTitle && (
        <h4 style={{ margin: "8px 0" }}>
          {COLOR_NAME[color]}'s remaining pieces
        </h4>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${minCell}px, 1fr))`,
          gap: 4,
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
                padding: 3,
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
                cellPx={cellPx}
                muted={!available}
              />
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
  background: "linear-gradient(135deg, #0d1117 0%, #1f0d14 50%, #0d1117 100%)",
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
  onCreateLobby: (name: string, preferredSide: "A" | "B") => void;
  onJoinLobby: (name: string, code: string) => void;
  lobbyCode: string | null;
  lobbyError: string | null;
  onClearError: () => void;
}> = ({ status, onFindGame, onCreateLobby, onJoinLobby, lobbyCode, lobbyError, onClearError }) => {
  const [name, setName] = useState("");
  const [joinMode, setJoinMode] = useState(false);
  const [codeInput, setCodeInput] = useState("");

  const hasName = name.trim().length > 0;
  const canPlay = hasName && status === "idle";
  const canCreate = hasName && status === "idle";
  const canJoin = codeInput.trim().length === 6 && status === "idle";

  const randomSide = (): "A" | "B" => (Math.random() > 0.5 ? "A" : "B");

  return (
    <div style={LOBBY_BG}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>
          BLOCK-IT BESTIES
        </h1>
        <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
          4 colours · classic rules
        </p>
      </div>

      <div style={CARD_STYLE}>
        {/* Name input */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 13, color: "#94a3b8" }}>Your name</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && canPlay && onFindGame(name.trim(), randomSide())}
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

        {/* Status banners */}
        {status === "waiting" && !lobbyCode && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, background:"rgba(236,72,153,0.15)", border:"1px solid rgba(236,72,153,0.4)", fontSize:14, color:"#f9a8d4" }}>
            <Spinner />
            Finding a match…
          </div>
        )}
        {lobbyCode && (
          <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"12px 14px", borderRadius:8, background:"rgba(22,163,74,0.15)", border:"1px solid rgba(22,163,74,0.4)" }}>
            <div style={{ fontSize:12, color:"#86efac" }}>Share this code with your friend:</div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontFamily:"monospace", fontSize:28, fontWeight:800, letterSpacing:6, color:"#f8fafc" }}>{lobbyCode}</span>
              <button onClick={() => navigator.clipboard.writeText(lobbyCode)} style={{ ...btn(), fontSize:12, padding:"4px 10px" }}>Copy</button>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#86efac" }}>
              <Spinner />
              Waiting for them to join…
            </div>
          </div>
        )}
        {lobbyError && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderRadius:8, background:"rgba(220,38,38,0.15)", border:"1px solid rgba(220,38,38,0.4)", fontSize:13, color:"#fca5a5" }}>
            {lobbyError}
            <button onClick={onClearError} style={{ background:"transparent", border:"none", color:"#fca5a5", cursor:"pointer", fontSize:16, lineHeight:1, padding:"0 4px" }}>×</button>
          </div>
        )}

        {/* Play Classic */}
        <button
          disabled={!canPlay}
          onClick={() => { onClearError(); onFindGame(name.trim(), randomSide()); }}
          style={{ padding:"14px 0", fontSize:16, fontWeight:700, borderRadius:10, border:"none", background: canPlay ? "linear-gradient(135deg, #ec4899, #be185d)" : "rgba(255,255,255,0.08)", color: canPlay ? "#fff" : "#475569", cursor: canPlay ? "pointer" : "not-allowed", boxShadow: canPlay ? "0 0 32px rgba(236,72,153,0.5)" : "none", letterSpacing:1 }}
        >
          Play Classic
        </button>

        {/* Divider */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.1)" }} />
          <span style={{ fontSize:12, color:"#475569" }}>or</span>
          <div style={{ flex:1, height:1, background:"rgba(255,255,255,0.1)" }} />
        </div>

        {/* Private lobby buttons */}
        {!joinMode ? (
          <div style={{ display:"flex", gap:10 }}>
            <button
              disabled={!canCreate}
              onClick={() => { onClearError(); onCreateLobby(name.trim(), randomSide()); }}
              style={{ flex:1, padding:"11px 0", fontSize:14, fontWeight:600, borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background: canCreate ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)", color: canCreate ? "#f8fafc" : "#475569", cursor: canCreate ? "pointer" : "not-allowed" }}
            >
              Create Private Game
            </button>
            <button
              disabled={!hasName || status === "waiting"}
              onClick={() => { onClearError(); setJoinMode(true); }}
              style={{ flex:1, padding:"11px 0", fontSize:14, fontWeight:600, borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background: hasName ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)", color: hasName ? "#f8fafc" : "#475569", cursor: (hasName && status === "idle") ? "pointer" : "not-allowed" }}
            >
              Join with Code
            </button>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <input
              autoFocus
              type="text"
              value={codeInput}
              onChange={(e) => { onClearError(); setCodeInput(e.target.value.toUpperCase().slice(0, 6)); }}
              onKeyDown={(e) => e.key === "Enter" && canJoin && onJoinLobby(name.trim(), codeInput)}
              placeholder="Enter 6-character code…"
              style={{ padding:"10px 14px", borderRadius:8, border:"1px solid rgba(255,255,255,0.2)", background:"rgba(255,255,255,0.08)", color:"#f8fafc", fontSize:16, outline:"none", fontFamily:"monospace", letterSpacing:4, textTransform:"uppercase" }}
            />
            <div style={{ display:"flex", gap:8 }}>
              <button
                disabled={!canJoin}
                onClick={() => onJoinLobby(name.trim(), codeInput)}
                style={{ flex:1, padding:"11px 0", fontSize:14, fontWeight:600, borderRadius:8, border:"none", background: canJoin ? "linear-gradient(135deg, #ec4899, #be185d)" : "rgba(255,255,255,0.08)", color: canJoin ? "#fff" : "#475569", cursor: canJoin ? "pointer" : "not-allowed" }}
              >
                Join Game
              </button>
              <button onClick={() => { setJoinMode(false); setCodeInput(""); onClearError(); }} style={{ ...btn("ghost"), padding:"11px 14px" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Spinner: React.FC = () => (
  <div
    style={{
      width: 16,
      height: 16,
      border: "2px solid rgba(249,168,212,0.3)",
      borderTopColor: "#f9a8d4",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      flexShrink: 0,
    }}
  >
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

export default Blokus;
