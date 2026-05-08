import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import http from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@les-infiltres/shared";
import { GameStore } from "./game.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:3000";
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? process.env.CLIENT_URL ?? PUBLIC_URL;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: CORS_ORIGIN, credentials: true }
});
const store = new GameStore();

app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "les-infiltres" });
});

const publicDir = path.resolve(__dirname, "../../frontend/dist");
app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

store.setBroadcaster((room) => {
  for (const { socketId, view } of store.views(room.code)) io.to(socketId).emit("roomState", view);
});
store.setNotifier((socketId, message) => {
  io.to(socketId).emit("toast", message);
});

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, ack) => {
    ack(store.createRoom(payload.name, payload.audioMode, socket.id, payload.sessionId, payload.config));
  });

  socket.on("joinRoom", (payload, ack) => {
    ack(store.joinRoom(payload.code, payload.name, socket.id, payload.sessionId));
  });

  socket.on("reconnectRoom", (payload, ack) => {
    ack(store.reconnect(payload.code, payload.sessionId, socket.id));
  });

  socket.on("updateConfig", ({ code, config }) => store.updateConfig(code, socket.id, config));
  socket.on("startGame", ({ code }) => store.startGame(code, socket.id));
  socket.on("electMayor", ({ code, targetId }) => store.electMayor(code, socket.id, targetId));
  socket.on("adminNext", ({ code }) => store.adminNext(code, socket.id));
  socket.on("endGame", ({ code }) => store.endGame(code, socket.id));
  socket.on("returnToLobby", ({ code }) => store.returnToLobby(code, socket.id));
  socket.on("nightAction", ({ code, ...action }) => store.nightAction(code, socket.id, action));
  socket.on("startDebate", ({ code, seconds }) => store.startDebate(code, socket.id, seconds));
  socket.on("grantSpeech", ({ code, playerId, seconds }) => store.grantSpeech(code, socket.id, playerId, seconds));
  socket.on("stopSpeech", ({ code }) => store.stopSpeech(code, socket.id));
  socket.on("startVote", ({ code, seconds }) => store.startVote(code, socket.id, seconds));
  socket.on("vote", ({ code, targetId }) => store.vote(code, socket.id, targetId));
  socket.on("setMuted", ({ code, playerId, muted }) => store.setMuted(code, socket.id, playerId, muted));
  socket.on("audioActivity", ({ code, speaking }) => store.audioActivity(code, socket.id, speaking));
  socket.on("rtcSignal", ({ code, to, signal }) => {
    const fromView = store.viewBySocket(code, socket.id);
    if (!fromView?.you) return;
    if (fromView.audioMode !== "integrated") return socket.emit("toast", "L'audio integre n'est pas actif dans cette partie.");
    const targetSocketId = store.socketIdForPlayer(code, to);
    if (targetSocketId) io.to(targetSocketId).emit("rtcSignal", { from: fromView.you.id, signal });
  });
  socket.on("disconnect", () => store.disconnect(socket.id));
});

server.listen(PORT, HOST, () => {
  console.log(`Les Infiltrés listening on http://${HOST}:${PORT}`);
});
