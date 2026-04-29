import React, { useEffect, useMemo, useState } from "react";

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

interface GameState {
  board: Board;
  current: ColorId;
  remaining: Record<ColorId, Set<string>>;
  history: PlacedPiece[];
  consecutivePasses: number; // resets on any successful placement
  lastPlacedWasMonomino: Record<ColorId, boolean>;
  finished: Record<ColorId, boolean>;
  passed: Record<ColorId, boolean>; // permanent: this color has no moves left ever
}

// -------------------- Constants --------------------

const BOARD_SIZE = 20;

// Classic Blokus turn order is clockwise from top-left.
const COLOR_ORDER: ColorId[] = [1, 2, 3, 4];

// Starting corners for each color.
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

// Player <-> colors mapping: A controls 1 & 3 (diagonal), B controls 2 & 4.
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

const PLAYER_NAME: Record<PlayerId, string> = {
  A: "Player A (Blue + Red)",
  B: "Player B (Yellow + Green)",
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

  // No edge-adjacent same-color cells.
  const EDGE = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
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

  const DIAG = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];
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
    const DIAG = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
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

// -------------------- React component --------------------

const Blokus: React.FC = () => {
  const [gameStarted, setGameStarted] = useState(false);
  const [state, setState] = useState<GameState>(makeInitialState);
  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<Shape | null>(null);
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const [message, setMessage] = useState<string>("");

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

  useEffect(() => {
    if (selectedPieceId) {
      setOrientation(PIECE_BY_ID[selectedPieceId].shape);
    } else {
      setOrientation(null);
    }
  }, [selectedPieceId]);

  // Auto-pass any color that has no legal moves at all (and never gets a turn
  // back). We re-evaluate at the start of each turn.
  useEffect(() => {
    if (gameOver) return;
    const c = state.current;

    // If this color has finished placing all pieces, just skip past it.
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

  function rotateSelected() {
    if (!orientation) return;
    setOrientation(rotateCW(orientation));
  }
  function flipSelected() {
    if (!orientation) return;
    setOrientation(flipH(orientation));
  }

  function tryPlaceAt(r: number, c: number) {
    if (gameOver || !selectedPieceId || !orientation) return;
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

    setState({
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
    });
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
  }

  function manualPass() {
    if (gameOver) return;
    const c = state.current;
    setState((s) => ({
      ...s,
      passed: { ...s.passed, [c]: true },
      current: nextColor(s.current),
      consecutivePasses: s.consecutivePasses + 1,
    }));
    setSelectedPieceId(null);
    setOrientation(null);
    setMessage(`${COLOR_NAME[c]} resigned (no more moves this game).`);
  }

  function resetGame() {
    setState(makeInitialState());
    setSelectedPieceId(null);
    setOrientation(null);
    setHover(null);
    setMessage("");
    setGameStarted(false);
  }

  const preview = useMemo(() => {
    if (!hover || !orientation || !selectedPieceId || gameOver) return null;
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
  }, [hover, orientation, selectedPieceId, state, gameOver, isFirstMoveFor]);

  // -------------------- Rendering --------------------

  const cellSize = 26;
  const currentColor = state.current;
  const currentPlayer = PLAYER_FOR_COLOR[currentColor];

  const teamA = teamScore(state, "A");
  const teamB = teamScore(state, "B");

  let winnerText: string | null = null;
  if (gameOver) {
    if (teamA > teamB) winnerText = `Player A wins! ${teamA} to ${teamB}.`;
    else if (teamB > teamA) winnerText = `Player B wins! ${teamB} to ${teamA}.`;
    else winnerText = `Tie! Both teams scored ${teamA}.`;
  }

  if (!gameStarted) {
    return <LobbyPage onStart={() => setGameStarted(true)} />;
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
                        cursor: selectedPieceId ? "pointer" : "default",
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
          <ScorePanel state={state} teamA={teamA} teamB={teamB} />

          {!gameOver && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                border: `2px solid ${COLOR_HEX[currentColor]}`,
                borderRadius: 6,
                background: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(8px)",
                boxShadow: `0 0 20px ${COLOR_HEX[currentColor]}33`,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {PLAYER_NAME[currentPlayer]}
              </div>
              <div style={{ marginBottom: 6, color: "#94a3b8", fontSize: 14 }}>
                Now playing:{" "}
                <span
                  style={{
                    background: COLOR_HEX[currentColor],
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 3,
                    fontWeight: 600,
                  }}
                >
                  {COLOR_NAME[currentColor]}
                </span>
              </div>
              {isFirstMoveFor[currentColor] ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  First {COLOR_NAME[currentColor]} move: piece must cover corner (
                  {START_SQUARES[currentColor][0] + 1},{" "}
                  {START_SQUARES[currentColor][1] + 1}).
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>
                  Must touch a diagonal corner of an existing{" "}
                  {COLOR_NAME[currentColor]} piece, with no shared edges.
                </div>
              )}

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
                  Resign {COLOR_NAME[currentColor]}
                </button>
                <button onClick={resetGame} style={btn("ghost")}>
                  Reset
                </button>
              </div>

              {orientation && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    Click a board cell to place — that cell becomes the piece's
                    top-left corner:
                  </div>
                  <ShapePreview
                    shape={orientation}
                    color={COLOR_HEX[currentColor]}
                    cellPx={20}
                  />
                </div>
              )}
            </div>
          )}

          <PieceTray
            color={currentColor}
            remaining={state.remaining}
            selectedPieceId={selectedPieceId}
            onPick={(id) => setSelectedPieceId(id)}
            disabled={gameOver}
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
}> = ({ state, teamA, teamB }) => {
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
      <div style={{ fontSize: 12, color: "#cbd5e1" }}>
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
        <strong>{PLAYER_NAME[player]}</strong>
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

const LobbyPage: React.FC<{ onStart: () => void }> = ({ onStart }) => {
  // "A" = Blue+Red (left), "B" = Yellow+Green (right). Players start on opposite sides.
  const [p1Side, setP1Side] = useState<"A" | "B">("A");
  const [p2Side, setP2Side] = useState<"A" | "B">("B");
  const canStart = p1Side !== p2Side;

  const chip = (label: string, side: "A" | "B") => (
    <div
      style={{
        padding: "10px 20px",
        borderRadius: 8,
        background:
          side === "A"
            ? `linear-gradient(135deg, ${COLOR_HEX[1]}, ${COLOR_HEX[3]})`
            : `linear-gradient(135deg, ${COLOR_HEX[2]}, ${COLOR_HEX[4]})`,
        color: "#fff",
        fontWeight: 700,
        fontSize: 15,
        whiteSpace: "nowrap" as const,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
      }}
    >
      {label}
    </div>
  );

  const arrowBtn = (onClick: () => void, label: string) => (
    <button
      onClick={onClick}
      style={{
        padding: "8px 14px",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(255,255,255,0.08)",
        color: "#f8fafc",
        cursor: "pointer",
        fontSize: 18,
        lineHeight: 1,
      }}
      title={label}
    >
      {label === "right" ? "›" : "‹"}
    </button>
  );

  // Each row: left zone | center arrows | right zone
  const playerRow = (
    playerLabel: string,
    side: "A" | "B",
    toggle: () => void
  ) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 80px 1fr",
        alignItems: "center",
        gap: 0,
        width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", paddingRight: 16 }}>
        {side === "A" && chip(playerLabel, "A")}
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        {arrowBtn(toggle, side === "A" ? "right" : "left")}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-start", paddingLeft: 16 }}>
        {side === "B" && chip(playerLabel, "B")}
      </div>
    </div>
  );

  const teamHeader = (colors: ColorId[], name: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {colors.map((c) => (
        <div
          key={c}
          style={{ width: 14, height: 14, borderRadius: 3, background: COLOR_HEX[c] }}
        />
      ))}
      <span style={{ fontWeight: 700, fontSize: 15 }}>{name}</span>
    </div>
  );

  return (
    <div
      style={{
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
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 48, letterSpacing: 4, fontWeight: 800 }}>BLOKUS</h1>
        <p style={{ margin: "8px 0 0", color: "#94a3b8", fontSize: 15 }}>
          Arrow over to claim your team, then start.
        </p>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 560,
          padding: "28px 24px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          background: "rgba(255,255,255,0.05)",
          backdropFilter: "blur(8px)",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", paddingRight: 16 }}>
            {teamHeader([1, 3], "Blue & Red")}
          </div>
          <div />
          <div style={{ paddingLeft: 16 }}>
            {teamHeader([2, 4], "Yellow & Green")}
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)" }} />

        {/* Player rows */}
        {playerRow("Player 1", p1Side, () => setP1Side(p1Side === "A" ? "B" : "A"))}
        {playerRow("Player 2", p2Side, () => setP2Side(p2Side === "A" ? "B" : "A"))}

        {!canStart && (
          <div style={{ textAlign: "center", fontSize: 13, color: "#f59e0b" }}>
            Both players are on the same team — one must switch.
          </div>
        )}
      </div>

      <button
        disabled={!canStart}
        onClick={onStart}
        style={{
          padding: "14px 56px",
          fontSize: 18,
          fontWeight: 700,
          borderRadius: 10,
          border: "none",
          background: canStart
            ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
            : "rgba(255,255,255,0.08)",
          color: canStart ? "#fff" : "#475569",
          cursor: canStart ? "pointer" : "not-allowed",
          boxShadow: canStart ? "0 0 32px rgba(99,102,241,0.5)" : "none",
          letterSpacing: 1,
        }}
      >
        Start Game
      </button>
    </div>
  );
};

export default Blokus;
