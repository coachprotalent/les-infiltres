import "dotenv/config";
import crypto from "node:crypto";
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
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: CORS_ORIGIN, credentials: true }
});
const store = new GameStore();
const adminTokens = new Map<string, number>();

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
store.setCloseNotifier((socketId, message) => {
  io.to(socketId).emit("roomClosed", message);
});

io.on("connection", (socket) => {
  const validateAdmin = (token: string) => {
    const createdAt = adminTokens.get(token);
    if (!createdAt) return false;
    if (Date.now() - createdAt > ADMIN_TOKEN_TTL_MS) {
      adminTokens.delete(token);
      return false;
    }
    return true;
  };

  socket.on("adminLogin", ({ username, password }, ack) => {
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin non configures." });
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return ack({ ok: false, error: "Identifiants admin invalides." });
    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.set(token, Date.now());
    ack({ ok: true, token });
  });

  socket.on("adminLogout", ({ token }) => {
    adminTokens.delete(token);
  });

  socket.on("adminListRooms", ({ token }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    ack({ ok: true, rooms: store.adminRooms() });
  });

  socket.on("adminRoomDetails", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    const room = store.adminRoomDetails(code);
    if (!room) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true, room });
  });

  socket.on("adminDeleteRoom", ({ token, code }, ack) => {
    if (!validateAdmin(token)) return ack({ ok: false, error: "Session admin invalide ou expiree." });
    if (!store.adminDeleteRoom(code)) return ack({ ok: false, error: "Salon introuvable." });
    ack({ ok: true });
  });

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
  socket.on("updateAudioMode", ({ code, audioMode }) => store.updateAudioMode(code, socket.id, audioMode));
  socket.on("closeRoom", ({ code }) => store.closeRoom(code, socket.id));
  socket.on("leaveRoom", ({ code }) => store.leaveRoom(code, socket.id));
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
    if (!store.canRelayRtcSignal(code, socket.id, to)) return;
    const targetSocketId = store.socketIdForPlayer(code, to);
    if (targetSocketId) io.to(targetSocketId).emit("rtcSignal", { from: fromView.you.id, signal });
  });
  socket.on("disconnect", () => store.disconnect(socket.id));
});

server.listen(PORT, HOST, () => {
  console.log(`Les Infiltrés listening on http://${HOST}:${PORT}`);
});
