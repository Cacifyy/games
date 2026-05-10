// Pure game logic for Blokus — no React, no network.

// -------------------- Types --------------------

export type ColorId = 1 | 2 | 3 | 4;
export type PlayerId = "A" | "B";
export type Cell = 0 | ColorId;
export type Board = Cell[][];
export type Shape = number[][];

export interface PieceDef {
  id: string;
  shape: Shape;
}

export interface PlacedPiece {
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

export type GameMode = "classic" | "timed";

export interface GameSettings {
  mode: GameMode;
  timerSeconds: number;
}

// Wire-format for GameState (Sets → arrays for JSON).
export interface SerializedState {
  board: number[][];
  current: ColorId;
  remaining: Record<string, string[]>;
  history: Array<{ color: ColorId; pieceId: string; cells: [number, number][] }>;
  consecutivePasses: number;
  lastPlacedWasMonomino: Record<string, boolean>;
  finished: Record<string, boolean>;
  passed: Record<string, boolean>;
}

// -------------------- Constants --------------------

export const BOARD_SIZE = 20;

export const COLOR_ORDER: ColorId[] = [1, 2, 3, 4];

export const START_SQUARES: Record<ColorId, [number, number]> = {
  1: [BOARD_SIZE - 1, 0],              // Blue:   bottom-left
  2: [0, BOARD_SIZE - 1],              // Yellow: top-right
  3: [BOARD_SIZE - 1, BOARD_SIZE - 1], // Red:    bottom-right
  4: [0, 0],                           // Green:  top-left
};

export const COLOR_NAME: Record<ColorId, string> = {
  1: "Blue",
  2: "Yellow",
  3: "Red",
  4: "Green",
};

export const DEFAULT_COLOR_HEX: Record<ColorId, string> = {
  1: "#2563eb",
  2: "#eab308",
  3: "#dc2626",
  4: "#16a34a",
};

export const DEFAULT_COLOR_LIGHT: Record<ColorId, string> = {
  1: "#bfdbfe",
  2: "#fde68a",
  3: "#fecaca",
  4: "#bbf7d0",
};

// 128-color palette: 16 hues × 8 shades (dark → light)
// Hues: Red, Rose, Orange, Amber, Yellow, Lime, Green, Emerald, Teal, Cyan, Sky, Blue, Indigo, Violet, Purple, Fuchsia
export const PALETTE: string[] = [
  "#7f1d1d", "#881337", "#7c2d12", "#78350f", "#713f12", "#365314", "#14532d", "#064e3b", "#134e4a", "#083344", "#0c4a6e", "#1e3a8a", "#1e1b4b", "#2e1065", "#3b0764", "#4a044e",
  "#991b1b", "#9f1239", "#9a3412", "#92400e", "#854d0e", "#3f6212", "#166534", "#065f46", "#115e59", "#164e63", "#075985", "#1e40af", "#312e81", "#4c1d95", "#581c87", "#701a75",
  "#b91c1c", "#be123c", "#c2410c", "#b45309", "#a16207", "#4d7c0f", "#15803d", "#047857", "#0f766e", "#0e7490", "#0369a1", "#1d4ed8", "#3730a3", "#5b21b6", "#6b21a8", "#a21caf",
  "#dc2626", "#e11d48", "#ea580c", "#d97706", "#ca8a04", "#65a30d", "#16a34a", "#059669", "#0d9488", "#0891b2", "#0284c7", "#2563eb", "#4338ca", "#7c3aed", "#7e22ce", "#c026d3",
  "#ef4444", "#f43f5e", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#f87171", "#fb7185", "#fb923c", "#fbbf24", "#facc15", "#a3e635", "#4ade80", "#34d399", "#2dd4bf", "#22d3ee", "#38bdf8", "#60a5fa", "#818cf8", "#a78bfa", "#c084fc", "#e879f9",
  "#fca5a5", "#fda4af", "#fdba74", "#fcd34d", "#fde047", "#bef264", "#86efac", "#6ee7b7", "#5eead4", "#67e8f9", "#7dd3fc", "#93c5fd", "#a5b4fc", "#c4b5fd", "#d8b4fe", "#f0abfc",
  "#fecaca", "#fecdd3", "#fed7aa", "#fde68a", "#fef08a", "#d9f99d", "#bbf7d0", "#a7f3d0", "#99f6e4", "#a5f3fc", "#bae6fd", "#bfdbfe", "#c7d2fe", "#ddd6fe", "#e9d5ff", "#f5d0fe",
];

export const PALETTE_NAMES: Record<string, string> = {
  // Red
  "#7f1d1d": "Dark Red",       "#991b1b": "Deep Red",      "#b91c1c": "Rich Red",     "#dc2626": "Red",
  "#ef4444": "Bright Red",     "#f87171": "Light Red",     "#fca5a5": "Pale Red",     "#fecaca": "Soft Red",
  // Rose
  "#881337": "Dark Rose",      "#9f1239": "Deep Rose",     "#be123c": "Rich Rose",    "#e11d48": "Rose",
  "#f43f5e": "Bright Rose",    "#fb7185": "Light Rose",    "#fda4af": "Pale Rose",    "#fecdd3": "Soft Rose",
  // Orange
  "#7c2d12": "Dark Orange",    "#9a3412": "Deep Orange",   "#c2410c": "Rich Orange",  "#ea580c": "Orange",
  "#f97316": "Bright Orange",  "#fb923c": "Light Orange",  "#fdba74": "Pale Orange",  "#fed7aa": "Soft Orange",
  // Amber
  "#78350f": "Dark Amber",     "#92400e": "Deep Amber",    "#b45309": "Rich Amber",   "#d97706": "Amber",
  "#f59e0b": "Bright Amber",   "#fbbf24": "Light Amber",   "#fcd34d": "Pale Amber",   "#fde68a": "Soft Amber",
  // Yellow
  "#713f12": "Dark Yellow",    "#854d0e": "Deep Yellow",   "#a16207": "Rich Yellow",  "#ca8a04": "Yellow",
  "#eab308": "Bright Yellow",  "#facc15": "Light Yellow",  "#fde047": "Pale Yellow",  "#fef08a": "Soft Yellow",
  // Lime
  "#365314": "Dark Lime",      "#3f6212": "Deep Lime",     "#4d7c0f": "Rich Lime",    "#65a30d": "Lime",
  "#84cc16": "Bright Lime",    "#a3e635": "Light Lime",    "#bef264": "Pale Lime",    "#d9f99d": "Soft Lime",
  // Green
  "#14532d": "Dark Green",     "#166534": "Deep Green",    "#15803d": "Rich Green",   "#16a34a": "Green",
  "#22c55e": "Bright Green",   "#4ade80": "Light Green",   "#86efac": "Pale Green",   "#bbf7d0": "Soft Green",
  // Emerald
  "#064e3b": "Dark Emerald",   "#065f46": "Deep Emerald",  "#047857": "Rich Emerald", "#059669": "Emerald",
  "#10b981": "Bright Emerald", "#34d399": "Light Emerald", "#6ee7b7": "Pale Emerald", "#a7f3d0": "Soft Emerald",
  // Teal
  "#134e4a": "Dark Teal",      "#115e59": "Deep Teal",     "#0f766e": "Rich Teal",    "#0d9488": "Teal",
  "#14b8a6": "Bright Teal",    "#2dd4bf": "Light Teal",    "#5eead4": "Pale Teal",    "#99f6e4": "Soft Teal",
  // Cyan
  "#083344": "Dark Cyan",      "#164e63": "Deep Cyan",     "#0e7490": "Rich Cyan",    "#0891b2": "Cyan",
  "#06b6d4": "Bright Cyan",    "#22d3ee": "Light Cyan",    "#67e8f9": "Pale Cyan",    "#a5f3fc": "Soft Cyan",
  // Sky
  "#0c4a6e": "Dark Sky Blue",  "#075985": "Deep Sky Blue", "#0369a1": "Rich Sky Blue","#0284c7": "Sky Blue",
  "#0ea5e9": "Bright Sky Blue","#38bdf8": "Light Sky Blue","#7dd3fc": "Pale Sky Blue","#bae6fd": "Soft Sky Blue",
  // Blue
  "#1e3a8a": "Dark Blue",      "#1e40af": "Deep Blue",     "#1d4ed8": "Rich Blue",    "#2563eb": "Blue",
  "#3b82f6": "Bright Blue",    "#60a5fa": "Light Blue",    "#93c5fd": "Pale Blue",    "#bfdbfe": "Soft Blue",
  // Indigo
  "#1e1b4b": "Dark Indigo",    "#312e81": "Deep Indigo",   "#3730a3": "Rich Indigo",  "#4338ca": "Indigo",
  "#6366f1": "Bright Indigo",  "#818cf8": "Light Indigo",  "#a5b4fc": "Pale Indigo",  "#c7d2fe": "Soft Indigo",
  // Violet
  "#2e1065": "Dark Violet",    "#4c1d95": "Deep Violet",   "#5b21b6": "Rich Violet",  "#7c3aed": "Violet",
  "#8b5cf6": "Bright Violet",  "#a78bfa": "Light Violet",  "#c4b5fd": "Pale Violet",  "#ddd6fe": "Soft Violet",
  // Purple
  "#3b0764": "Dark Purple",    "#581c87": "Deep Purple",   "#6b21a8": "Rich Purple",  "#7e22ce": "Purple",
  "#a855f7": "Bright Purple",  "#c084fc": "Light Purple",  "#d8b4fe": "Pale Purple",  "#e9d5ff": "Soft Purple",
  // Fuchsia
  "#4a044e": "Dark Fuchsia",   "#701a75": "Deep Fuchsia",  "#a21caf": "Rich Fuchsia", "#c026d3": "Fuchsia",
  "#d946ef": "Bright Fuchsia", "#e879f9": "Light Fuchsia", "#f0abfc": "Pale Fuchsia", "#f5d0fe": "Soft Fuchsia",
};

export function lightenColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (v: number) => Math.round(v + (255 - v) * 0.65);
  return `#${mix(r).toString(16).padStart(2, "0")}${mix(g).toString(16).padStart(2, "0")}${mix(b).toString(16).padStart(2, "0")}`;
}

export const COLORS_FOR: Record<PlayerId, ColorId[]> = {
  A: [1, 3],
  B: [2, 4],
};

export const PLAYER_FOR_COLOR: Record<ColorId, PlayerId> = {
  1: "A",
  3: "A",
  2: "B",
  4: "B",
};

// -------------------- Piece definitions (21 standard) --------------------

export const PIECES: PieceDef[] = [
  { id: "I1", shape: [[1]] },
  { id: "I2", shape: [[1, 1]] },
  { id: "I3", shape: [[1, 1, 1]] },
  { id: "V3", shape: [[1, 0], [1, 1]] },
  { id: "I4", shape: [[1, 1, 1, 1]] },
  { id: "L4", shape: [[1, 0], [1, 0], [1, 1]] },
  { id: "T4", shape: [[1, 1, 1], [0, 1, 0]] },
  { id: "S4", shape: [[1, 1, 0], [0, 1, 1]] },
  { id: "O4", shape: [[1, 1], [1, 1]] },
  { id: "F",  shape: [[0, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { id: "I5", shape: [[1, 1, 1, 1, 1]] },
  { id: "L5", shape: [[1, 0], [1, 0], [1, 0], [1, 1]] },
  { id: "N",  shape: [[0, 1], [0, 1], [1, 1], [1, 0]] },
  { id: "P",  shape: [[1, 1], [1, 1], [1, 0]] },
  { id: "T5", shape: [[1, 1, 1], [0, 1, 0], [0, 1, 0]] },
  { id: "U",  shape: [[1, 0, 1], [1, 1, 1]] },
  { id: "V5", shape: [[1, 0, 0], [1, 0, 0], [1, 1, 1]] },
  { id: "W",  shape: [[1, 0, 0], [1, 1, 0], [0, 1, 1]] },
  { id: "X",  shape: [[0, 1, 0], [1, 1, 1], [0, 1, 0]] },
  { id: "Y",  shape: [[0, 1], [1, 1], [0, 1], [0, 1]] },
  { id: "Z5", shape: [[1, 1, 0], [0, 1, 0], [0, 1, 1]] },
];

export const PIECE_BY_ID: Record<string, PieceDef> = Object.fromEntries(
  PIECES.map((p) => [p.id, p])
);

// -------------------- Shape utilities --------------------

export function shapeSize(shape: Shape): number {
  let n = 0;
  for (const row of shape) for (const v of row) if (v) n++;
  return n;
}

export function rotateCW(shape: Shape): Shape {
  const rows = shape.length;
  const cols = shape[0].length;
  const out: Shape = Array.from({ length: cols }, () => Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      out[c][rows - 1 - r] = shape[r][c];
  return out;
}

export function flipH(shape: Shape): Shape {
  return shape.map((row) => [...row].reverse());
}

export function shapesEqual(a: Shape, b: Shape): boolean {
  if (a.length !== b.length) return false;
  if (a[0].length !== b[0].length) return false;
  for (let r = 0; r < a.length; r++)
    for (let c = 0; c < a[0].length; c++)
      if (a[r][c] !== b[r][c]) return false;
  return true;
}

export function shapeCells(shape: Shape): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) cells.push([r, c]);
  return cells;
}

export function allOrientations(shape: Shape): Shape[] {
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

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
}

export function validatePlacement(
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
      if (inBounds(nr, nc) && board[nr][nc] === color)
        return { ok: false, reason: "Cannot share an edge with your own color." };
    }
  }

  if (isFirstMove) {
    const [sr, sc] = START_SQUARES[color];
    if (!cells.some(([r, c]) => r === sr && c === sc))
      return { ok: false, reason: `${COLOR_NAME[color]}'s first piece must cover the corner (${sr + 1}, ${sc + 1}).` };
    return { ok: true };
  }

  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  for (const [r, c] of cells) {
    for (const [dr, dc] of DIAG) {
      const nr = r + dr;
      const nc = c + dc;
      if (inBounds(nr, nc) && board[nr][nc] === color) return { ok: true };
    }
  }
  return { ok: false, reason: "Must touch at least one diagonal corner of one of this color's pieces." };
}

// -------------------- Move enumeration --------------------

export function hasAnyLegalMove(
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
          if (validatePlacement(board, color, shape, ar - cr, ac - cc, isFirstMove).ok)
            return true;
        }
      }
    }
  }
  return false;
}

// -------------------- Scoring --------------------

export function colorScore(state: GameState, color: ColorId): number {
  let leftover = 0;
  for (const id of state.remaining[color]) leftover += shapeSize(PIECE_BY_ID[id].shape);
  if (state.finished[color]) {
    leftover -= 15;
    if (state.lastPlacedWasMonomino[color]) leftover -= 5;
  }
  return leftover;
}

export function teamScore(state: GameState, player: PlayerId): number {
  return COLORS_FOR[player].reduce((acc, c) => acc + colorScore(state, c), 0);
}

// -------------------- Initial state --------------------

export function makeInitialState(): GameState {
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

export function nextColor(c: ColorId): ColorId {
  const idx = COLOR_ORDER.indexOf(c);
  return COLOR_ORDER[(idx + 1) % COLOR_ORDER.length];
}

// -------------------- Serialization --------------------

export function serializeState(gs: GameState): SerializedState {
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

export function deserializeState(s: SerializedState): GameState {
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
