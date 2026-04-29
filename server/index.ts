import { WebSocketServer, WebSocket } from "ws";
import http from "http";

type PlayerId = "A" | "B";

interface JoinMsg { type: "join"; name: string; preferredSide: PlayerId }
interface MoveMsg { type: "move"; state: unknown }
type ClientMsg = JoinMsg | MoveMsg;

const PORT = Number(process.env.PORT ?? 3001);

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Blokus WS server");
});

const wss = new WebSocketServer({ server: httpServer });

// Maps each connected socket to its paired partner.
const partners = new Map<WebSocket, WebSocket>();

// First player to join waits here until a second arrives.
let waiting: { ws: WebSocket; name: string; preferredSide: PlayerId } | null = null;

function send(ws: WebSocket, payload: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on("connection", (ws) => {
  console.log(`Client connected (${wss.clients.size} total)`);

  ws.on("message", (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString()) as ClientMsg;
    } catch {
      return;
    }

    if (msg.type === "join") {
      if (!waiting) {
        // First to arrive — wait for a partner.
        waiting = { ws, name: msg.name, preferredSide: msg.preferredSide };
        send(ws, { type: "waiting" });
        console.log(`${msg.name} is waiting for an opponent`);
      } else {
        // Second player — pair them up, honoring side preferences when possible.
        const { ws: partnerWs, name: partnerName, preferredSide: partnerPref } = waiting;
        waiting = null;

        partners.set(ws, partnerWs);
        partners.set(partnerWs, ws);

        // First connected keeps their pick; second gets whatever's left.
        const partnerSide: PlayerId = partnerPref;
        const newSide: PlayerId = partnerSide === "A" ? "B" : "A";

        send(partnerWs, { type: "start", playerId: partnerSide, opponentName: msg.name });
        send(ws,        { type: "start", playerId: newSide,     opponentName: partnerName });
        console.log(`Paired: ${partnerName} (${partnerSide}) vs ${msg.name} (${newSide})`);
      }
      return;
    }

    if (msg.type === "move") {
      const partner = partners.get(ws);
      if (partner) send(partner, { type: "state", state: msg.state });
    }
  });

  ws.on("close", () => {
    console.log(`Client disconnected (${wss.clients.size} remaining)`);
    if (waiting?.ws === ws) waiting = null;

    const partner = partners.get(ws);
    if (partner) {
      send(partner, { type: "opponent_disconnected" });
      partners.delete(partner);
    }
    partners.delete(ws);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Blokus WS server → ws://localhost:${PORT}`);
});
