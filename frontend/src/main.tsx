import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import { ArrowLeft, Clock, Copy, Crown, Eye, Gavel, Lock, LogOut, Mic, MicOff, Moon, Play, RefreshCw, Settings, Shield, Sun, Trash2, Users, Vote } from "lucide-react";
import type { AdminRoomDetails, AdminRoomSummary, ClientToServerEvents, GameConfig, Role, RoomView, ServerToClientEvents } from "@les-infiltres/shared";
import { DEFAULT_CONFIG, ROLE_ABILITIES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, mergeConfig } from "@les-infiltres/shared";
import "./styles.css";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type RtcSignal = RTCSessionDescriptionInit | RTCIceCandidateInit;
type PeerEntry = {
  connection: RTCPeerConnection;
  audio?: HTMLAudioElement;
};
type AudioPermission = "idle" | "requesting" | "granted" | "denied" | "missing" | "unsupported";
type TimerInfo = {
  label: string;
  secondsLeft: number;
  duration: number;
  progress: number;
  urgent: boolean;
};

const socket: AppSocket = io("/", { autoConnect: true });
const sessionKey = "les-infiltres-session";
const roomKey = "les-infiltres-room";
const adminTokenKey = "les-infiltres-admin-token";
const phaseTutorialKey = "les-infiltres-phase-tutorial-seen";

function App() {
  const [view, setView] = useState<RoomView | null>(null);
  const [toast, setToast] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [audioMode, setAudioMode] = useState<"integrated" | "external">("external");
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const leaveRoom = (message?: string) => {
      localStorage.removeItem(sessionKey);
      localStorage.removeItem(roomKey);
      setView(null);
      if (message) setToast(message);
    };
    socket.on("roomState", (next) => {
      persist(next);
      setView(next);
    });
    socket.on("toast", setToast);
    socket.on("roomClosed", leaveRoom);
    const sessionId = localStorage.getItem(sessionKey);
    const roomCode = localStorage.getItem(roomKey);
    if (sessionId && roomCode) {
      socket.emit("reconnectRoom", { code: roomCode, sessionId }, (result) => {
        if (result.ok) {
          persist(result.view);
          setView(result.view);
        }
      });
    }
    return () => {
      socket.off("roomState");
      socket.off("toast");
      socket.off("roomClosed", leaveRoom);
    };
  }, []);

  const create = () => {
    if (!name.trim()) return setToast("Entre ton nom.");
    socket.emit("createRoom", { name, audioMode, config, sessionId: localStorage.getItem(sessionKey) ?? undefined }, (next) => {
      persist(next);
      setView(next);
    });
  };

  const join = () => {
    if (!name.trim() || !code.trim()) return setToast("Entre ton nom et le code.");
    socket.emit("joinRoom", { code, name, sessionId: localStorage.getItem(sessionKey) ?? undefined }, (result) => {
      if (!result.ok) return setToast(result.error);
      persist(result.view);
      setView(result.view);
    });
  };

  if (!view) {
    if (adminOpen) return <AdminPage onBack={() => setAdminOpen(false)} />;
    return (
      <main className="shell home">
        <section className="brand">
          <span className="eyebrow">Roles caches et debat public</span>
          <h1>Les Infiltres</h1>
          <p>Le serveur distribue les roles, verrouille les secrets, gere les pouvoirs et verifie automatiquement la victoire.</p>
        </section>
        <section className="entry">
          <label>
            Nom
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Aubin" maxLength={32} />
          </label>
          <div className="mode">
            <button className={audioMode === "external" ? "selected" : ""} onClick={() => setAudioMode("external")}>Audio externe</button>
            <button className={audioMode === "integrated" ? "selected" : ""} onClick={() => setAudioMode("integrated")}>Audio integre MVP</button>
          </div>
          <ConfigEditor config={config} onChange={setConfig} compact />
          <button className="primary" onClick={create}><Play size={18} /> Creer une partie</button>
          <div className="join">
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CODE" maxLength={5} />
            <button onClick={join}>Rejoindre</button>
          </div>
          <button className="admin-link" onClick={() => setAdminOpen(true)}><Lock size={16} /> Administration</button>
          {toast && <p className="toast">{toast}</p>}
          <p className="muted">Le choix audio ne bloque jamais la creation du salon. Le micro se teste apres creation, dans le lobby.</p>
        </section>
      </main>
    );
  }

  const leaveRoom = () => {
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(roomKey);
    setView(null);
  };

  return <Game view={view} toast={toast} onToast={setToast} onLeaveRoom={leaveRoom} />;
}

function AdminPage({ onBack }: { onBack: () => void }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(adminTokenKey) ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<AdminRoomSummary[]>([]);
  const [details, setDetails] = useState<AdminRoomDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadRooms = (activeToken = token) => {
    if (!activeToken) return;
    setLoading(true);
    socket.emit("adminListRooms", { token: activeToken }, (result) => {
      setLoading(false);
      if (!result.ok) {
        sessionStorage.removeItem(adminTokenKey);
        setToken("");
        setRooms([]);
        setDetails(null);
        return setMessage(result.error);
      }
      setRooms(result.rooms);
      setMessage("");
    });
  };

  useEffect(() => {
    if (token) loadRooms(token);
  }, [token]);

  const login = (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    socket.emit("adminLogin", { username, password }, (result) => {
      setLoading(false);
      if (!result.ok) return setMessage(result.error);
      sessionStorage.setItem(adminTokenKey, result.token);
      setToken(result.token);
      setPassword("");
      setMessage("");
    });
  };

  const logout = () => {
    if (token) socket.emit("adminLogout", { token });
    sessionStorage.removeItem(adminTokenKey);
    setToken("");
    setRooms([]);
    setDetails(null);
  };

  const showDetails = (code: string) => {
    socket.emit("adminRoomDetails", { token, code }, (result) => {
      if (!result.ok) return setMessage(result.error);
      setDetails(result.room);
      setMessage("");
    });
  };

  const deleteRoom = (room: AdminRoomSummary) => {
    if (!window.confirm(`Supprimer le salon ${room.code} ? Tous les joueurs seront renvoyes a l'accueil.`)) return;
    socket.emit("adminDeleteRoom", { token, code: room.code }, (result) => {
      if (!result.ok) return setMessage(result.error);
      setMessage(`Salon ${room.code} supprime.`);
      setDetails(null);
      loadRooms();
    });
  };

  if (!token) {
    return (
      <main className="shell admin-page">
        <button className="admin-link" onClick={onBack}><ArrowLeft size={16} /> Retour accueil</button>
        <section className="entry admin-login">
          <h1>Administration</h1>
          <form onSubmit={login}>
            <label>
              Identifiant
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label>
              Mot de passe
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
            <button className="primary" disabled={loading || !username || !password}><Lock size={17} /> Connexion</button>
          </form>
          {message && <p className="toast">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell admin-page">
      <section className="panel admin-dashboard">
        <div className="admin-toolbar">
          <div>
            <span className="eyebrow">Administration</span>
            <h1>Salons actifs</h1>
          </div>
          <div className="actions-row">
            <button onClick={() => loadRooms()} disabled={loading}><RefreshCw size={16} /> Refresh</button>
            <button onClick={logout}><LogOut size={16} /> Deconnexion</button>
            <button onClick={onBack}><ArrowLeft size={16} /> Accueil</button>
          </div>
        </div>
        {message && <p className="toast">{message}</p>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Hote</th>
                <th>Joueurs</th>
                <th>Statut</th>
                <th>Audio</th>
                <th>Creation</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.code}>
                  <td><strong>{room.code}</strong></td>
                  <td>{room.hostName}</td>
                  <td>{room.connectedPlayers} / {room.playerCount}</td>
                  <td>{adminStatusLabel(room.status)}</td>
                  <td>{room.audioMode === "integrated" ? "integre" : "externe"}</td>
                  <td>{new Date(room.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="admin-actions">
                      <button onClick={() => showDetails(room.code)}><Eye size={16} /> Voir details</button>
                      <button className="danger" onClick={() => deleteRoom(room)}><Trash2 size={16} /> Supprimer</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rooms.length && (
                <tr>
                  <td colSpan={7}>Aucun salon actif.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {details && (
          <div className="admin-details">
            <h2>Details du salon {details.code}</h2>
            <p>Phase : {phaseLabel(details.phase)} - Tour {details.round}</p>
            <div className="players">
              {details.players.map((player) => (
                <div className={`player ${player.alive ? "" : "out"}`} key={player.id}>
                  <span>{player.name}{player.isBot ? " - IA" : ""}{player.isHost ? " - Hote" : ""}{player.isMayor ? " - Maire" : ""}</span>
                  <small>{player.connected ? "en ligne" : "deconnecte"} - {player.alive ? "en jeu" : "elimine"}</small>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Game({ view, toast, onToast, onLeaveRoom }: { view: RoomView; toast: string; onToast: (message: string) => void; onLeaveRoom: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [voiceEnabled, setVoiceEnabled] = useState(() => localStorage.getItem("les-infiltres-voice") === "on");
  const audio = useIntegratedAudio(view, onToast);
  const you = view.you;
  const alivePlayers = view.players.filter((player) => player.alive);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (view.transition && "vibrate" in navigator) navigator.vibrate?.(70);
    if (voiceEnabled) playAmbienceCue(view.transition ?? view.phase);
  }, [view.transition, view.round]);

  useEffect(() => {
    if (!voiceEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(view.narrator);
    utterance.lang = "fr-FR";
    utterance.rate = 0.92;
    utterance.pitch = 0.82;
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled, view.narrator]);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    localStorage.setItem("les-infiltres-voice", next ? "on" : "off");
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
  };
  const quit = () => {
    const label = view.phase === "LOBBY" ? "Quitter le salon" : "Quitter la partie";
    const hostLobby = view.phase === "LOBBY" && !!you?.isHost;
    const message = hostLobby
      ? "Vous etes l'hote. Quitter transferera le salon au prochain joueur, ou fermera le salon si vous etes seul. Continuer ?"
      : `${label} ?`;
    if (!window.confirm(message)) return;
    socket.emit("leaveRoom", { code: view.code });
    onLeaveRoom();
  };

  const timer = getTimerInfo(view, now);
  const mayor = view.players.find((player) => player.id === view.mayorId);

  return (
    <main className={`shell game phase-${view.phase.toLowerCase()}`}>
      <header className="topbar">
        <div>
          <span className="eyebrow">Partie</span>
          <button className="code" onClick={() => navigator.clipboard?.writeText(view.code)} title="Copier le code">
            {view.code} <Copy size={16} />
          </button>
        </div>
        <StatusPill view={view} timer={timer} />
      </header>

      {view.transition && <TransitionBanner transition={view.transition} />}

      <section className="stage">
        <div className="narrator">
          {view.phase === "NIGHT" ? <Moon /> : ["DAY_ANNOUNCEMENT", "DEBATE", "DEFENSE"].includes(view.phase) ? <Sun /> : view.phase === "MAYOR_ELECTION" ? <Crown /> : <Gavel />}
          <div>
            <span>Narrateur automatique</span>
            <p>{view.narrator}</p>
          </div>
          <button className={voiceEnabled ? "voice-on" : ""} onClick={toggleVoice}>{voiceEnabled ? "Voix active" : "Activer voix"}</button>
        </div>
        {you && <button className="danger" onClick={quit}>{view.phase === "LOBBY" ? "Quitter le salon" : "Quitter la partie"}</button>}
        {mayor && <p className="mayor-line"><Crown size={16} /> Maire : {mayor.name}</p>}
        {timer && <PhaseTimer timer={timer} />}
        {you && !you.alive && <p className="spectator-line">Vous etes emprisonne. Vous pouvez observer la partie, mais vous ne pouvez plus voter, parler ou agir.</p>}
        {toast && <p className="toast">{toast}</p>}
      </section>

      <div className="layout">
        <section className="panel main-panel">
          <PhaseIntro view={view} />
          <PhaseContent view={view} timer={timer} onLeaveRoom={onLeaveRoom} />
          {view.phase !== "LOBBY" && view.phase !== "GAME_OVER" && <ChatPanel view={view} />}
        </section>

        <aside className="panel side-panel">
          <AudioPanel view={view} audio={audio} />
          <h2><Users size={18} /> Joueurs</h2>
          <div className="players">
            {view.players.map((player) => (
              <div className={`player ${player.alive ? "" : "out"} ${player.speaking ? "speaking" : ""} ${player.audioActive ? "audio-active" : ""}`} key={player.id}>
                <span>{player.name}{player.isBot ? " - IA" : ""}{player.isMayor ? " - Maire" : ""}{player.isHost ? " - Hote" : ""}</span>
                <small>
                  {player.connected ? "en ligne" : "deconnecte"}
                  {!player.canVote && player.alive ? " - sans vote" : ""}
                  {!player.alive && player.revealedRole ? ` - ${ROLE_LABELS[player.revealedRole]}` : ""}
                </small>
                {player.muted ? <MicOff size={16} /> : <Mic size={16} />}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {you?.isMayor && you.alive && <MayorPanel view={view} alivePlayers={alivePlayers} timer={timer} />}
      {you?.isHost && <AdminPanel view={view} />}
    </main>
  );
}

function PhaseContent({ view, timer, onLeaveRoom }: { view: RoomView; timer?: TimerInfo; onLeaveRoom: () => void }) {
  const hasPhasePanel = hasKnownPhasePanel(view.phase);
  return (
    <>
      {view.phase === "LOBBY" && <Lobby view={view} />}
      {view.phase === "MAYOR_NOMINATION" && <MayorNomination view={view} />}
      {view.phase === "MAYOR_ELECTION" && <MayorElection view={view} />}
      {view.phase !== "LOBBY" && view.you && <RoleCard view={view} />}
      {view.phase === "NIGHT" && <NightPanel view={view} />}
      {["DAY_ANNOUNCEMENT", "DEBATE", "DEFENSE"].includes(view.phase) && <DebatePanel view={view} timer={timer} />}
      {view.phase === "NOMINATION" && <NominationPanel view={view} />}
      {view.phase === "DEFENSE_REQUESTS" && <DefenseRequestsPanel view={view} />}
      {view.phase === "VOTING" && <VotePanel view={view} />}
      {view.phase === "RESULT" && <ResultPanel view={view} />}
      {view.phase === "GAME_OVER" && <EndPanel view={view} onLeaveRoom={onLeaveRoom} />}
      {!hasPhasePanel && <PhaseFallback view={view} timer={timer} />}
    </>
  );
}

function hasKnownPhasePanel(phase: RoomView["phase"] | string) {
  return [
    "LOBBY",
    "MAYOR_NOMINATION",
    "MAYOR_ELECTION",
    "NIGHT",
    "DAY_ANNOUNCEMENT",
    "DEBATE",
    "NOMINATION",
    "DEFENSE_REQUESTS",
    "DEFENSE",
    "VOTING",
    "RESULT",
    "GAME_OVER"
  ].includes(phase);
}

function PhaseFallback({ view, timer }: { view: RoomView; timer?: TimerInfo }) {
  return (
    <div className="content phase-fallback">
      <h2>{phaseLabel(view.phase)}</h2>
      <p>{view.narrator || "La partie continue. En attente de la prochaine action."}</p>
      {timer && <PhaseTimer timer={timer} compact />}
      <p className="muted">Phase actuelle : {phaseLabel(view.phase)}.</p>
    </div>
  );
}

function PhaseIntro({ view }: { view: RoomView }) {
  const phaseKey = view.phase === "NIGHT" && view.currentNightStep ? `NIGHT:${view.currentNightStep}` : view.phase;
  const [seen, setSeen] = useState<Set<string>>(() => readPhaseTutorialSeen(view.code));
  const [expandedKey, setExpandedKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    const stored = readPhaseTutorialSeen(view.code);
    setSeen(stored);
    setExpandedKey(stored.has(phaseKey) ? undefined : phaseKey);
  }, [view.code, phaseKey]);
  const tutorial = phaseTutorialFor(view);
  useEffect(() => {
    if (!tutorial || view.phase === "LOBBY" || view.phase === "GAME_OVER" || seen.has(phaseKey)) return;
    const next = new Set(seen);
    next.add(phaseKey);
    setSeen(next);
    localStorage.setItem(`${phaseTutorialKey}:${view.code}`, JSON.stringify([...next]));
  }, [phaseKey, seen, tutorial?.title, view.code, view.phase]);
  if (!tutorial || view.phase === "LOBBY" || view.phase === "GAME_OVER") return null;
  if (expandedKey !== phaseKey) return <p className="phase-reminder">{tutorial.short}</p>;
  return (
    <div className="phase-intro">
      <div>
        <span className="eyebrow">Guide de phase</span>
        <h2>{tutorial.title}</h2>
        <p>{tutorial.body}</p>
      </div>
      <button onClick={() => setExpandedKey(undefined)}>Compris</button>
    </div>
  );
}

function readPhaseTutorialSeen(code: string) {
  try {
    const raw = localStorage.getItem(`${phaseTutorialKey}:${code}`);
    const values = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set<string>();
  }
}

function phaseTutorialFor(view: RoomView) {
  if (view.phase === "MAYOR_NOMINATION") return {
    title: "Nomination du Maire",
    body: "Les joueurs vivants proposent publiquement les candidats au poste de Maire. Vous pouvez modifier votre nomination jusqu'a la fin du chrono.",
    short: "Nominations Maire : proposez ou modifiez votre candidat."
  };
  if (view.phase === "MAYOR_ELECTION") return {
    title: "Vote du Maire",
    body: "Votez uniquement parmi les candidats nomines. Le joueur avec le plus de voix devient Maire et gerera la parole.",
    short: "Vote Maire : choisissez parmi les candidats verrouilles."
  };
  if (view.phase === "DEBATE") return {
    title: "Debat",
    body: "Pendant cette phase, les joueurs debattent afin d'identifier les suspects. Le Maire peut laisser la parole libre ou verrouiller les micros.",
    short: "Debat : discutez, sauf si le Maire verrouille la parole."
  };
  if (view.phase === "NOMINATION") return {
    title: "Nomination",
    body: "Choisissez les joueurs que vous souhaitez voir passer au vote. Les nominations sont publiques et modifiables jusqu'a la fin du chrono.",
    short: "Nominations : designez les suspects."
  };
  if (view.phase === "DEFENSE_REQUESTS" || view.phase === "DEFENSE") return {
    title: "Defense",
    body: "Les joueurs nomines peuvent demander au Maire l'autorisation de se defendre avant le vote.",
    short: "Defense : les nomines demandent la parole au Maire."
  };
  if (view.phase === "VOTING") return {
    title: "Vote",
    body: "Votez publiquement parmi les joueurs nomines. Les bonus du Sage et du Maire sont comptes au depouillement.",
    short: "Vote : choisissez parmi les nomines."
  };
  if (view.phase === "NIGHT" && view.currentNightStep === "infiltres") return {
    title: "Phase Infiltres",
    body: "Les Infiltres choisissent secretement leur cible. Les autres joueurs voient des etats audio neutralises, sauf la Guetteuse qui peut observer au risque de s'exposer.",
    short: "Infiltres : cible secrete, etats audio masques."
  };
  if (view.phase === "NIGHT" && view.activeRole === "Hackeuse") return {
    title: "Hackeuse",
    body: "La Hackeuse peut enqueter sur un joueur et decouvrir secretement son role.",
    short: "Hackeuse : enquetez sur un joueur."
  };
  if (view.phase === "NIGHT") return {
    title: "Nuit",
    body: "Les roles se reveillent un par un. Le joueur concerne peut agir ou terminer son tour sans attendre la fin du chrono.",
    short: "Nuit : agissez ou terminez votre tour."
  };
  return undefined;
}

function useIntegratedAudio(view: RoomView, onToast: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<AudioPermission>("idle");
  const [peerCount, setPeerCount] = useState(0);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerEntry>());
  const viewRef = useRef(view);
  const activityFrameRef = useRef<number | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const lastActivityRef = useRef(false);

  viewRef.current = view;

  const stopAudio = () => {
    if (activityFrameRef.current) window.cancelAnimationFrame(activityFrameRef.current);
    activityFrameRef.current = undefined;
    void audioContextRef.current?.close();
    audioContextRef.current = undefined;
    if (lastActivityRef.current) socket.emit("audioActivity", { code: viewRef.current.code, speaking: false });
    lastActivityRef.current = false;
    for (const peer of peersRef.current.values()) {
      peer.audio?.remove();
      peer.connection.close();
    }
    peersRef.current.clear();
    setPeerCount(0);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setEnabled(false);
    setPermission("idle");
  };

  const setLocalActivity = (speaking: boolean) => {
    if (lastActivityRef.current === speaking) return;
    lastActivityRef.current = speaking;
    socket.emit("audioActivity", { code: viewRef.current.code, speaking });
  };

  const startActivityMeter = (stream: MediaStream) => {
    if (!window.AudioContext) return;
    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    const data = new Uint8Array(analyser.fftSize);
    source.connect(analyser);
    const tick = () => {
      const current = viewRef.current;
      const player = currentPlayer(current);
      const canTransmit = current.audioMode === "integrated" && current.phase !== "GAME_OVER" && !!current.you?.canHearAudio && !!current.you.canSpeak && !player?.muted;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const volume = Math.sqrt(sum / data.length);
      setLocalActivity(canTransmit && volume > 0.035);
      activityFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  };

  const ensurePeer = (peerId: string, initiator: boolean) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing.connection;
    const connection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const entry: PeerEntry = { connection };
    peersRef.current.set(peerId, entry);
    setPeerCount(peersRef.current.size);

    localStreamRef.current?.getTracks().forEach((track) => connection.addTrack(track, localStreamRef.current!));
    connection.onicecandidate = (event) => {
      if (event.candidate) socket.emit("rtcSignal", { code: viewRef.current.code, to: peerId, signal: event.candidate.toJSON() });
    };
    connection.ontrack = (event) => {
      const [stream] = event.streams;
      if (!entry.audio) {
        entry.audio = new Audio();
        entry.audio.autoplay = true;
        document.body.appendChild(entry.audio);
      }
      entry.audio.srcObject = stream;
      entry.audio.muted = !canHearRemote(viewRef.current, peerId);
      void entry.audio.play().catch(() => undefined);
    };
    if (initiator) {
      void connection.createOffer()
        .then((offer) => connection.setLocalDescription(offer).then(() => offer))
        .then((offer) => socket.emit("rtcSignal", { code: viewRef.current.code, to: peerId, signal: offer }))
        .catch(() => onToast("Connexion audio impossible avec un joueur."));
    }
    return connection;
  };

  const startAudio = async () => {
    if (view.audioMode !== "integrated") return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setPermission("unsupported");
      onToast("Navigateur non compatible avec l'audio integre.");
      return;
    }
    setPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setPermission("missing");
        onToast("Aucun micro detecte.");
        return;
      }
      localStreamRef.current = stream;
      setEnabled(true);
      setPermission("granted");
      startActivityMeter(stream);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setPermission("missing");
        onToast("Aucun micro detecte.");
      } else {
        setPermission("denied");
        onToast("Permission micro refusee.");
      }
    }
  };

  useEffect(() => {
    if ((view.audioMode !== "integrated" || view.phase === "GAME_OVER" || !view.you?.canHearAudio) && enabled) stopAudio();
  }, [view.audioMode, view.phase, enabled]);

  useEffect(() => {
    const canTransmit = view.audioMode === "integrated" && enabled && !!view.you?.canHearAudio && !!view.you.canSpeak && !currentPlayer(view)?.muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = canTransmit;
    });
    if (!canTransmit) setLocalActivity(false);
    for (const [peerId, peer] of peersRef.current.entries()) {
      if (peer.audio) peer.audio.muted = !canHearRemote(view, peerId);
    }
  }, [view, enabled]);

  useEffect(() => {
    if (!enabled || view.audioMode !== "integrated" || !view.you || !localStreamRef.current) return;
    const peerIds = view.you.audioPeerIds;
    for (const peerId of peerIds) ensurePeer(peerId, true);
    for (const [peerId, peer] of peersRef.current.entries()) {
      if (!peerIds.includes(peerId)) {
        peer.audio?.remove();
        peer.connection.close();
        peersRef.current.delete(peerId);
        setPeerCount(peersRef.current.size);
      }
    }
  }, [view.you?.audioPeerIds.join(","), view.audioMode, view.you?.id, enabled]);

  useEffect(() => {
    const onSignal = async ({ from, signal }: { from: string; signal: unknown }) => {
      if (!enabled || viewRef.current.audioMode !== "integrated" || !localStreamRef.current || !viewRef.current.you) return;
      const connection = ensurePeer(from, false);
      const typedSignal = signal as RtcSignal;
      try {
        if ("type" in typedSignal && (typedSignal.type === "offer" || typedSignal.type === "answer")) {
          await connection.setRemoteDescription(typedSignal);
          if (typedSignal.type === "offer") {
            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            socket.emit("rtcSignal", { code: viewRef.current.code, to: from, signal: answer });
          }
        } else {
          await connection.addIceCandidate(typedSignal as RTCIceCandidateInit);
        }
      } catch {
        onToast("Signal audio invalide ou connexion audio interrompue.");
      }
    };
    socket.on("rtcSignal", onSignal);
    return () => {
      socket.off("rtcSignal", onSignal);
    };
  }, [enabled]);

  useEffect(() => stopAudio, []);

  return {
    enabled,
    permission,
    startAudio,
    stopAudio,
    activePeers: peerCount
  };
}

function Lobby({ view }: { view: RoomView }) {
  const [draft, setDraft] = useState(view.config);
  const [editing, setEditing] = useState(false);
  const [botCount, setBotCount] = useState(1);
  const [botTarget, setBotTarget] = useState(Math.max(view.lobby.minPlayers, view.lobby.playerCount));
  const canStart = view.lobby.playerCount >= view.lobby.minPlayers;

  useEffect(() => setDraft(view.config), [view.config]);

  const saveConfig = (next: GameConfig) => {
    setDraft(next);
    socket.emit("updateConfig", { code: view.code, config: next });
  };
  const closeRoom = () => {
    if (window.confirm("Fermer le salon pour tous les joueurs ?")) socket.emit("closeRoom", { code: view.code });
  };

  return (
    <div className="content">
      <h2>Lobby</h2>
      <div className="stats-grid">
        <Metric label="Joueurs" value={`${view.lobby.playerCount} / ${view.lobby.maxPlayers}`} />
        <Metric label="Manquants" value={view.lobby.missingPlayers === 0 ? "Pret" : `${view.lobby.missingPlayers}`} />
        <Metric label="Infiltres prevus" value={`${view.lobby.plannedInfiltrators}`} />
        <Metric label="Egalite" value={view.config.tieRule === "revote" ? "Revote" : "Aucun elimine"} />
      </div>
      <div>
        <h3>Roles potentiels</h3>
        <div className="chips">{view.lobby.potentialRoles.map((role) => <span key={role}>{ROLE_LABELS[role]}</span>)}</div>
      </div>
      {view.you?.isHost && (
        <div className="actions-row">
          <button onClick={() => setEditing((value) => !value)}>{editing ? "Retour au lobby" : "Modifier la configuration"}</button>
          <button className="danger" onClick={closeRoom}>Fermer le salon</button>
        </div>
      )}
      {view.you?.isHost && (
        <div className="bot-controls">
          <h3>Joueurs IA</h3>
          {view.botAi.enabled ? (
            <>
              <div className="config-grid">
                <ConfigField label="Nombre de bots" help={`Maximum par salon : ${view.botAi.maxPerRoom}.`}>
                  <NumericConfigInput value={botCount} min={1} max={view.botAi.maxPerRoom} onCommit={setBotCount} />
                </ConfigField>
                <ConfigField label="Completer jusqu'a" help="Ajoute uniquement les bots manquants pour atteindre ce nombre de joueurs.">
                  <NumericConfigInput value={botTarget} min={view.lobby.minPlayers} max={view.lobby.maxPlayers} onCommit={setBotTarget} />
                </ConfigField>
              </div>
              <div className="actions-row">
                <button onClick={() => socket.emit("addBot", { code: view.code })}>Ajouter un bot IA</button>
                <button onClick={() => socket.emit("addBots", { code: view.code, count: botCount })}>Ajouter {botCount} bot(s)</button>
                <button onClick={() => socket.emit("fillWithBots", { code: view.code, targetCount: botTarget })}>Completer jusqu'a {botTarget}</button>
              </div>
            </>
          ) : (
            <p className="muted">Bots IA desactives. Configurez Azure OpenAI cote serveur pour les activer.</p>
          )}
        </div>
      )}
      {view.you?.isHost && editing && (
        <>
          <AudioModeEditor code={view.code} audioMode={view.audioMode} />
          <ConfigEditor config={draft} onChange={saveConfig} />
        </>
      )}
      {view.you?.isHost ? (
        <button className="primary" disabled={!canStart} onClick={() => socket.emit("startGame", { code: view.code })}>
          <Play size={18} /> Lancer la partie
        </button>
      ) : (
        <p className="muted">En attente du lancement par l'hote.</p>
      )}
    </div>
  );
}

function ConfigEditor({ config, onChange, compact = false }: { config: GameConfig; onChange: (config: GameConfig) => void; compact?: boolean }) {
  const update = (patch: Partial<GameConfig>) => onChange(mergeConfig({ ...config, ...patch, durations: { ...config.durations, ...patch.durations } }));
  const toggleRole = (role: Role) => {
    const enabled = new Set(config.enabledRoles);
    if (enabled.has(role)) enabled.delete(role);
    else enabled.add(role);
    enabled.add("Infiltre");
    update({ enabledRoles: [...enabled] });
  };

  return (
    <div className={`config ${compact ? "compact" : ""}`}>
      <h3><Settings size={16} /> Configuration avancee</h3>
      <div className="config-grid">
        <ConfigField label="Max joueurs" help="Nombre maximum de joueurs autorises dans la partie.">
          <NumericConfigInput value={config.maxPlayers} min={7} max={20} onCommit={(value) => update({ maxPlayers: value })} />
        </ConfigField>
        <ConfigField label="Egalite" help="Regle appliquee si un vote finit a egalite. Aucun elimine signifie que personne n'est emprisonne.">
          <select value={config.tieRule} onChange={(e) => update({ tieRule: e.target.value === "revote" ? "revote" : "none" })}><option value="none">Aucun elimine</option><option value="revote">Revote</option></select>
        </ConfigField>
        <ConfigField label="Election du Maire" help="Duree en secondes de l'election publique du Maire.">
          <NumericConfigInput value={config.durations.mayorElection} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, mayorElection: value } })} />
        </ConfigField>
        <ConfigField label="Action de nuit" help="Duree maximum en secondes pour chaque role appele pendant la nuit.">
          <NumericConfigInput value={config.durations.nightAction} min={5} max={60} step={5} onCommit={(value) => update({ durations: { ...config.durations, nightAction: value } })} />
        </ConfigField>
        <ConfigField label="Debat" help="Duree en secondes du debat general pendant la journee.">
          <NumericConfigInput value={config.durations.freeDebate} min={15} max={3600} step={5} onCommit={(value) => update({ durations: { ...config.durations, freeDebate: value } })} />
        </ConfigField>
        <ConfigField label="Nominations" help="Duree en secondes de l'etape de nomination avant le vote.">
          <NumericConfigInput value={config.durations.nomination} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, nomination: value } })} />
        </ConfigField>
        <ConfigField label="Defense" help="Duree en secondes accordee a un joueur pour se defendre.">
          <NumericConfigInput value={config.durations.defense} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, defense: value } })} />
        </ConfigField>
        <ConfigField label="Vote" help="Duree en secondes de la phase de vote.">
          <NumericConfigInput value={config.durations.vote} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, vote: value } })} />
        </ConfigField>
      </div>
      {!compact && (
        <>
          <div className="toggles">
            <label><input type="checkbox" checked={config.deadCanHearAudio} onChange={(e) => update({ deadCanHearAudio: e.target.checked })} /> Morts entendent l'audio</label>
            <label><input type="checkbox" checked={config.requireSpecialRoles} onChange={(e) => update({ requireSpecialRoles: e.target.checked })} /> Roles speciaux obligatoires</label>
          </div>
          <div className="chips role-toggles">
            {ROLES.filter((role) => role !== "Croyant").map((role) => (
              <button key={role} className={config.enabledRoles.includes(role) ? "selected" : ""} disabled={role === "Infiltre"} onClick={() => toggleRole(role)}>
                {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NumericConfigInput({ value, min, max, step = 1, onCommit }: { value: number; min: number; max: number; step?: number; onCommit: (value: number) => void }) {
  const [inputValue, setInputValue] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!editing) setInputValue(String(value));
  }, [value, editing]);

  const commit = (rawValue = inputValue) => {
    const raw = rawValue.trim();
    if (!raw) {
      setInputValue(String(value));
      setError("Valeur requise");
      return;
    }
    if (!/^\d+$/.test(raw)) {
      setInputValue(String(value));
      setError("Nombre invalide");
      return;
    }
    const numeric = Number(raw);
    if (numeric < min) {
      setInputValue(String(min));
      setError(`Minimum : ${min}`);
      onCommit(min);
      return;
    }
    if (numeric > max) {
      setInputValue(String(max));
      setError(`Maximum : ${max}`);
      onCommit(max);
      return;
    }
    setInputValue(String(numeric));
    setError("");
    onCommit(numeric);
  };

  const bump = (delta: number) => {
    const parsed = /^\d+$/.test(inputValue.trim()) ? Number(inputValue.trim()) : value;
    const next = Math.min(max, Math.max(min, parsed + delta));
    setEditing(false);
    setInputValue(String(next));
    setError("");
    onCommit(next);
  };

  return (
    <div className="numeric-config">
      <button type="button" aria-label="Diminuer" onClick={() => bump(-step)}>-</button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          setInputValue(event.target.value);
          setError("");
        }}
        onBlur={() => {
          setEditing(false);
          commit();
        }}
      />
      <button type="button" aria-label="Augmenter" onClick={() => bump(step)}>+</button>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function AudioModeEditor({ code, audioMode }: { code: string; audioMode: "integrated" | "external" }) {
  return (
    <div className="config">
      <h3><Mic size={16} /> Mode audio</h3>
      <div className="mode">
        <button className={audioMode === "external" ? "selected" : ""} onClick={() => socket.emit("updateAudioMode", { code, audioMode: "external" })}>Audio externe</button>
        <button className={audioMode === "integrated" ? "selected" : ""} onClick={() => socket.emit("updateAudioMode", { code, audioMode: "integrated" })}>Audio integre</button>
      </div>
    </div>
  );
}

function ConfigField({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <label className="config-field">
      <span>{label}<span className="help-dot" title={help}>?</span></span>
      {children}
      <small>{help}</small>
    </label>
  );
}

function MayorNomination({ view }: { view: RoomView }) {
  const ownNomination = view.mayorNominationDetails.find((vote) => vote.voterId === view.you?.id);
  const [targetId, setTargetId] = useState(ownNomination?.targetId ?? "");
  const canNominate = !!view.you?.alive && !!view.you?.canVote;
  useEffect(() => setTargetId(ownNomination?.targetId ?? ""), [ownNomination?.targetId]);
  return (
    <div className="content">
      <h2>Nomination du Maire</h2>
      <p>Proposez publiquement les candidats au poste de Maire. Le dernier choix remplace le precedent jusqu'a la fin du chrono.</p>
      {canNominate ? (
        <>
          <SelectTarget value={targetId} onChange={(value) => {
            setTargetId(value);
            if (value) socket.emit("nominateMayor", { code: view.code, targetId: value });
          }} players={view.players.filter((player) => player.alive)} />
          <button className="primary" disabled={!targetId} onClick={() => socket.emit("nominateMayor", { code: view.code, targetId })}>
            <Crown size={18} /> {ownNomination ? "Changer ma nomination" : "Nominer comme Maire"}
          </button>
          {ownNomination && <p className="muted">Votre nomination actuelle : <strong>{ownNomination.targetName}</strong>.</p>}
        </>
      ) : (
        <p className="muted">Vous observez les nominations sans participer.</p>
      )}
      <PublicVoteBoard title="Nominations Maire publiques" emptyText="Aucune candidature proposee." details={view.mayorNominationDetails} totals={view.mayorNominationTotals} verb="propose" />
    </div>
  );
}

function MayorElection({ view }: { view: RoomView }) {
  const ownVote = view.mayorVoteDetails.find((vote) => vote.voterId === view.you?.id);
  const [targetId, setTargetId] = useState(ownVote?.targetId ?? "");
  const canVote = !!view.you?.alive && !!view.you?.canVote;
  const nomineeSet = new Set(view.mayorNominees);
  const candidates = view.players.filter((player) => player.alive && (!view.mayorNominees.length || nomineeSet.has(player.id)));
  useEffect(() => setTargetId(ownVote?.targetId ?? ""), [ownVote?.targetId]);
  return (
    <div className="content">
      <h2>Election du Maire</h2>
      <p>Le Maire est une fonction publique, distincte des roles secrets. Le vote est limite aux candidats nomines.</p>
      <PublicVoteBoard title="Candidats Maire verrouilles" emptyText="Aucun candidat verrouille." details={view.mayorNominationDetails} totals={view.mayorNominationTotals} verb="a propose" />
      <p>{view.mayorVotes.length} vote(s) enregistres.</p>
      {canVote && <SelectTarget value={targetId} onChange={(value) => {
        setTargetId(value);
        if (value) socket.emit("electMayor", { code: view.code, targetId: value });
      }} players={candidates} />}
      <button className="primary" disabled={!targetId || !canVote} onClick={() => socket.emit("electMayor", { code: view.code, targetId })}>
        <Crown size={18} /> {ownVote ? "Changer mon vote" : "Voter pour le Maire"}
      </button>
      {ownVote && <p className="muted">Votre vote actuel : <strong>{ownVote.targetName}</strong>.</p>}
      {!canVote && <p className="muted">Vous observez l'election sans voter.</p>}
      <PublicVoteBoard title="Votes du Maire" emptyText="Aucun vote enregistre." details={view.mayorVoteDetails} totals={view.mayorVoteTotals} verb="vote pour" />
    </div>
  );
}

function RoleCard({ view }: { view: RoomView }) {
  const role = view.you?.role;
  if (!role) return null;
  return (
    <div className="role-card">
      <div className="role-card-meta">
        <span>Votre role secret</span>
        {view.you?.isMayor && <span className="role-badge"><Crown size={14} /> Maire</span>}
      </div>
      <h2>{ROLE_LABELS[role]}</h2>
      <p>{ROLE_DESCRIPTIONS[role]}</p>
      <ul className="ability-list">
        {ROLE_ABILITIES[role].map((ability) => <li key={ability}>{ability}</li>)}
      </ul>
      {view.you?.powerStatuses.map((power) => (
        <small className={power.used ? "used-power" : ""} key={power.key}>{power.label} : {power.used ? "Pouvoir deja utilise" : "Disponible"}</small>
      ))}
      {view.you?.secretInfo.map((info, index) => <small key={`${info}-${index}`}>{info}</small>)}
    </div>
  );
}

function NightPanel({ view }: { view: RoomView }) {
  const role = view.you?.role;
  const isLeaderInterrupt = role === "LeaderLouange" && view.currentNightStep === "infiltres" && !!view.you?.alive;
  const isWatcher = role === "Guetteuse" && view.currentNightStep === "infiltres" && !!view.you?.alive;
  const isActive = ((!!role && view.activeRole === role) || isLeaderInterrupt || isWatcher) && !!view.you?.alive;
  const aliveTargets = view.players.filter((player) => player.alive && player.id !== view.you?.id);
  const allAlive = view.players.filter((player) => player.alive);
  const [targetId, setTargetId] = useState("");

  useEffect(() => setTargetId(""), [view.currentNightStep]);

  if (!isActive) {
    return (
      <div className="sleep-screen">
        <Moon size={42} />
        <h2>Dormez...</h2>
        <p>{view.you?.nightChannel === "sleep" ? "Votre role n'agit pas maintenant." : "Vous observez la partie sans interaction."}</p>
      </div>
    );
  }

  if (view.currentNightStep === "agent-double") {
    return (
      <ActionBlock title="Agent Double">
        <PowerNotice view={view} />
        <div className="cards">{view.roleOptions?.map((option) => <button key={option} onClick={() => socket.emit("nightAction", { code: view.code, roleChoice: option })}>{ROLE_LABELS[option]}</button>)}</div>
        <button onClick={() => socket.emit("finishNightStep", { code: view.code })}>Terminer mon tour</button>
      </ActionBlock>
    );
  }

  if (view.currentNightStep === "ministre") {
    const saveUsed = view.you?.powerStatuses.find((power) => power.key === "ministerSave")?.used;
    const jailUsed = view.you?.powerStatuses.find((power) => power.key === "ministerJail")?.used;
    return (
      <ActionBlock title="Ministre">
        <PowerNotice view={view} />
        <SelectTarget value={targetId} onChange={setTargetId} players={aliveTargets} />
        <div className="actions-row">
          <button disabled={saveUsed} onClick={() => socket.emit("nightAction", { code: view.code, ministerAction: "save" })}>Sauver la victime</button>
          <button disabled={!targetId || jailUsed} onClick={() => socket.emit("nightAction", { code: view.code, ministerAction: "jail", targetId })}>Emprisonner cette personne</button>
          <button onClick={() => socket.emit("finishNightStep", { code: view.code })}>Terminer mon tour</button>
        </div>
      </ActionBlock>
    );
  }

  if (isLeaderInterrupt) {
    return (
      <ActionBlock title="Leader de Louange">
        <p>Vous pouvez entonner un cantique pour interrompre la nuit. Tout le monde ouvrira les yeux et le jeu passera au jour.</p>
        <button className="primary" onClick={() => socket.emit("nightAction", { code: view.code })}>Entonner un cantique</button>
        <button onClick={() => socket.emit("finishNightStep", { code: view.code })}>Terminer mon tour</button>
      </ActionBlock>
    );
  }

  if (isWatcher) {
    return (
      <ActionBlock title="Guetteuse">
        <p>Vous observez discretement l'etape des Infiltres. Les informations utiles apparaissent dans votre carte de role.</p>
      </ActionBlock>
    );
  }

  const targets = view.currentNightStep === "avocate" ? allAlive : aliveTargets;
  return (
    <ActionBlock title={view.currentNightStep === "infiltres" ? "Communication des Infiltres" : "Action de nuit"}>
      <PowerNotice view={view} />
      <SelectTarget value={targetId} onChange={setTargetId} players={targets} />
      {view.currentNightStep === "infiltres" && <p className="muted">Seuls les Infiltres voient cette interface et designent une victime commune.</p>}
      {view.currentNightStep === "infiltres" && <InfiltratorVoteBoard view={view} />}
      <div className="actions-row">
        <button className="primary" disabled={!targetId} onClick={() => socket.emit("nightAction", { code: view.code, targetId })}>Valider</button>
        <button onClick={() => socket.emit("finishNightStep", { code: view.code })}>Valider et continuer</button>
      </div>
    </ActionBlock>
  );
}

function InfiltratorVoteBoard({ view }: { view: RoomView }) {
  const votes = view.infiltratorVotes ?? [];
  return (
    <div className="vote-ledger private-ledger">
      <h3>Choix des Infiltres</h3>
      {votes.length ? (
        votes.map((vote) => <p key={vote.voterId}><strong>{vote.voterName}</strong> cible <strong>{vote.targetName}</strong></p>)
      ) : (
        <p className="muted">Aucun choix enregistre.</p>
      )}
      {view.infiltratorVoteLeader && <p>Total actuel : <strong>{view.infiltratorVoteLeader.targetName}</strong> ({view.infiltratorVoteLeader.total})</p>}
    </div>
  );
}

function PowerNotice({ view }: { view: RoomView }) {
  const used = view.you?.powerStatuses.filter((power) => power.used) ?? [];
  if (!used.length) return null;
  return <p className="used-power">Pouvoir deja utilise : {used.map((power) => power.label).join(", ")}</p>;
}

function ChatPanel({ view }: { view: RoomView }) {
  const [text, setText] = useState("");
  const me = currentPlayer(view);
  const canChat = !!view.you?.alive && !!view.you.canSpeak && !me?.muted && !(view.phase === "NIGHT" && view.you.role !== "Infiltre");
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    socket.emit("sendChat", { code: view.code, text: clean });
    setText("");
  };
  return (
    <div className="chat-panel">
      <h3>Messages</h3>
      <div className="chat-log">
        {view.chatMessages.length ? view.chatMessages.slice(-12).map((message) => (
          <p key={message.id} className={message.scope === "infiltres" ? "private-message" : ""}>
            <strong>{message.playerName}</strong> {message.scope === "infiltres" ? <span>Infiltres</span> : null}
            {message.text}
          </p>
        )) : <p className="muted">Aucun message visible.</p>}
      </div>
      {canChat && (
        <form className="chat-form" onSubmit={submit}>
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={280} placeholder="Ecrire un message" />
          <button>Envoyer</button>
        </form>
      )}
    </div>
  );
}

function DebatePanel({ view, timer }: { view: RoomView; timer?: TimerInfo }) {
  const speaker = view.players.find((player) => player.id === view.activePlayerId);
  return (
    <div className="content">
      <h2>{view.phase === "DAY_ANNOUNCEMENT" ? "Le jour se leve" : view.phase === "DEFENSE" ? "Defense individuelle" : "Debat en cours"}</h2>
      <p>Joueur qui parle : <strong>{speaker?.name ?? "discussion libre"}</strong></p>
      {timer ? <PhaseTimer timer={timer} compact /> : <p>Temps restant : <strong>non chronometre</strong></p>}
      {!view.you?.isMayor && <p className="muted">Le Maire controle la parole et le passage au vote.</p>}
    </div>
  );
}

function NominationPanel({ view }: { view: RoomView }) {
  const ownNomination = view.nominationDetails.find((vote) => vote.voterId === view.you?.id);
  const [targetId, setTargetId] = useState(ownNomination?.targetId ?? "");
  const canNominate = !!view.you?.alive && !!view.you?.canVote;
  useEffect(() => setTargetId(ownNomination?.targetId ?? ""), [ownNomination?.targetId]);
  return (
    <div className="content">
      <h2>Nominations</h2>
      <p>Chaque joueur vivant peut nominer un suspect. Le dernier choix remplace le precedent jusqu'a la fin du chrono.</p>
      {canNominate ? (
        <>
          <SelectTarget value={targetId} onChange={(value) => {
            setTargetId(value);
            if (value) socket.emit("nominate", { code: view.code, targetId: value });
          }} players={view.players.filter((player) => player.alive && player.id !== view.you?.id)} />
          <button className="primary" disabled={!targetId} onClick={() => socket.emit("nominate", { code: view.code, targetId })}>
            <Gavel size={18} /> {ownNomination ? "Changer ma nomination" : "Nominer"}
          </button>
          {ownNomination && <p className="muted">Votre nomination actuelle : <strong>{ownNomination.targetName}</strong>.</p>}
        </>
      ) : (
        <p className="muted">Vous etes emprisonne : vous observez les nominations sans participer.</p>
      )}
      <PublicVoteBoard title="Nominations publiques" emptyText="Aucune nomination enregistree." details={view.nominationDetails} totals={view.nominationTotals} verb="nomine" />
    </div>
  );
}

function DefenseRequestsPanel({ view }: { view: RoomView }) {
  const requested = view.defenseRequests.find((request) => request.playerId === view.you?.id);
  const isNominee = !!view.you?.alive && view.nominees.includes(view.you.id);
  const nomineePlayers = view.players.filter((player) => view.nominees.includes(player.id));
  return (
    <div className="content">
      <h2>Demandes de defense</h2>
      <p>Liste finale des nomines : <strong>{nomineePlayers.map((player) => player.name).join(", ")}</strong>.</p>
      <PublicVoteBoard title="Nominations verrouillees" emptyText="Aucun nomine." details={view.nominationDetails} totals={view.nominationTotals} verb="a nomine" />
      {isNominee ? (
        <div className="defense-request-card">
          <p>Vous etes nomine. Vous pouvez demander au Maire de vous accorder un temps de defense.</p>
          <button className="primary" disabled={!!requested} onClick={() => socket.emit("requestDefense", { code: view.code })}>
            <Gavel size={18} /> Demander a se defendre
          </button>
          {requested && <p className="muted">Demande {defenseRequestStatusLabel(requested.status)}.</p>}
        </div>
      ) : (
        <p className="muted">{view.you?.alive ? "Seuls les joueurs nomines peuvent demander une defense." : "Vous etes emprisonne : vous observez les defenses sans participer."}</p>
      )}
      <DefenseRequestBoard requests={view.defenseRequests} />
    </div>
  );
}

function VotePanel({ view }: { view: RoomView }) {
  const ownVote = view.voteDetails.find((vote) => vote.voterId === view.you?.id);
  const [targetId, setTargetId] = useState(ownVote?.targetId ?? "");
  const canVote = !!view.you?.alive && !!view.you?.canVote;
  const nomineeSet = new Set(view.nominees);
  const targets = view.players.filter((player) => player.alive && player.id !== view.you?.id && (!view.nominees.length || nomineeSet.has(player.id)));
  useEffect(() => setTargetId(ownVote?.targetId ?? ""), [ownVote?.targetId]);
  return (
    <div className="content">
      <h2>Vote</h2>
      <p>{view.votes.length} vote(s) enregistres. Le vote est limite aux joueurs nomines. Le Sage vaut 2 voix. Le Maire ajoute +1 voix.</p>
      <PublicVoteBoard title="Nominations verrouillees" emptyText="Aucun nomine." details={view.nominationDetails} totals={view.nominationTotals} verb="a nomine" />
      {canVote ? (
        <>
          <SelectTarget value={targetId} onChange={setTargetId} players={targets} />
          <button className="primary" disabled={!targetId} onClick={() => socket.emit("vote", { code: view.code, targetId })}><Vote size={18} /> {ownVote ? "Changer mon vote" : "Voter"}</button>
          {ownVote && <p className="muted">Votre vote actuel : <strong>{ownVote.targetName}</strong>.</p>}
        </>
      ) : (
        <p className="muted">Vous etes emprisonne : vous observez le vote sans participer.</p>
      )}
      <PublicVoteBoard title="Votes publics" emptyText="Aucun vote enregistre." details={view.voteDetails} totals={view.voteTotals} verb="vote contre" weighted />
    </div>
  );
}

function DefenseRequestBoard({ requests }: { requests: RoomView["defenseRequests"] }) {
  return (
    <div className="vote-ledger">
      <h3>Demandes recues</h3>
      {requests.length ? (
        requests.map((request) => (
          <p key={request.playerId}>
            <strong>{request.playerName}</strong> : {defenseRequestStatusLabel(request.status)}
          </p>
        ))
      ) : (
        <p className="muted">Aucune demande de defense pour l'instant.</p>
      )}
    </div>
  );
}

function defenseRequestStatusLabel(status: RoomView["defenseRequests"][number]["status"]) {
  const labels: Record<RoomView["defenseRequests"][number]["status"], string> = {
    pending: "en attente",
    granted: "accordee",
    refused: "passee",
    done: "terminee"
  };
  return labels[status];
}

function PublicVoteBoard({ title, emptyText, details, totals, verb, weighted = false }: { title: string; emptyText: string; details: RoomView["voteDetails"]; totals: RoomView["voteTotals"]; verb: string; weighted?: boolean }) {
  return (
    <div className="vote-ledger">
      <h3>{title}</h3>
      {details.length ? (
        details.map((vote) => (
          <p key={vote.voterId}>
            <strong>{vote.voterName}</strong> {verb} <strong>{vote.targetName}</strong>
            {weighted && vote.mayorBonus && " - voix du Maire +1"}
            {weighted && vote.sageBonus && " - voix du Sage x2"}
            {weighted && <> ({vote.weight} voix)</>}
          </p>
        ))
      ) : (
        <p className="muted">{emptyText}</p>
      )}
      {!!totals.length && (
        <div className="vote-totals">
          <strong>Total</strong>
          {totals.map((total) => <span key={total.targetId}>{total.targetName} : {total.total}</span>)}
        </div>
      )}
    </div>
  );
}

function ResultPanel({ view }: { view: RoomView }) {
  return (
    <div className="content">
      <h2>Resultat</h2>
      <p>{view.lastResult}</p>
      {view.you?.isHost && <p className="muted">L'hote peut debloquer le retour a la nuit avec son panneau admin.</p>}
    </div>
  );
}

function EndPanel({ view, onLeaveRoom }: { view: RoomView; onLeaveRoom: () => void }) {
  return (
    <div className="content">
      <h2>Fin de partie</h2>
      {view.winner ? <p>Victoire : <strong>{view.winner}</strong></p> : <p><strong>Partie terminee par l'hote.</strong></p>}
      <p>{view.narrator}</p>
      <div className="actions-row">
        {view.you?.isHost && <button className="primary" onClick={() => socket.emit("returnToLobby", { code: view.code })}>Retour au lobby</button>}
        <button onClick={onLeaveRoom}>Créer une nouvelle partie</button>
      </div>
      {view.gameLog && <GameLog entries={view.gameLog} />}
    </div>
  );
}

function MayorPanel({ view, alivePlayers, timer }: { view: RoomView; alivePlayers: RoomView["players"]; timer?: TimerInfo }) {
  const [speechPlayer, setSpeechPlayer] = useState(alivePlayers[0]?.id ?? "");
  const speaker = view.players.find((player) => player.id === view.activePlayerId);
  const pendingDefenseRequests = view.defenseRequests.filter((request) => request.status === "pending");
  const closeDebate = () => {
    if (window.confirm("Cloturer le debat et passer aux nominations ?")) socket.emit("closeDebate", { code: view.code });
  };
  return (
    <section className="hostbar mayorbar">
      <strong><Crown size={17} /> Panneau Maire</strong>
      {timer && <span className={timer.urgent ? "timer-inline urgent" : "timer-inline"}>{timer.label} : {formatSeconds(timer.secondsLeft)}</span>}
      {(view.phase === "DAY_ANNOUNCEMENT" || view.phase === "DEBATE") && (
        <>
          <select value={speechPlayer} onChange={(event) => setSpeechPlayer(event.target.value)}>{alivePlayers.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select>
          <button onClick={() => socket.emit("startDebate", { code: view.code })}>Debat global</button>
          <button disabled={!speechPlayer} onClick={() => socket.emit("grantSpeech", { code: view.code, playerId: speechPlayer })}>Donner parole</button>
          <button onClick={() => socket.emit("stopSpeech", { code: view.code })}>Couper</button>
        </>
      )}
      {view.phase === "DEFENSE" && <button onClick={() => socket.emit("stopSpeech", { code: view.code })}>Arreter la defense</button>}
      {["DAY_ANNOUNCEMENT", "DEBATE"].includes(view.phase) ? (
        <button onClick={closeDebate}>Passer aux nominations</button>
      ) : view.phase === "DEFENSE_REQUESTS" ? (
        <button onClick={() => socket.emit("startVote", { code: view.code })}>Passer au vote</button>
      ) : view.phase === "DEFENSE" ? (
        <button disabled>Defense en cours</button>
      ) : (
        <button disabled={view.phase !== "NOMINATION"} onClick={() => socket.emit("startVote", { code: view.code })}>Cloturer les nominations</button>
      )}
      <span>{speaker ? `Parle : ${speaker.name}` : "Parole libre"}</span>
      {view.phase === "DEFENSE_REQUESTS" && (
        <div className="mayor-defense-requests">
          {pendingDefenseRequests.length ? pendingDefenseRequests.map((request) => (
            <span key={request.playerId}>
              {request.playerName}
              <button onClick={() => socket.emit("grantSpeech", { code: view.code, playerId: request.playerId })}>Accorder la defense</button>
              <button onClick={() => socket.emit("denyDefense", { code: view.code, playerId: request.playerId })}>Passer</button>
            </span>
          )) : <span>Aucune demande en attente</span>}
        </div>
      )}
    </section>
  );
}

function AdminPanel({ view }: { view: RoomView }) {
  const confirmEndGame = () => {
    if (window.confirm("Mettre fin a la partie pour tous les joueurs ?")) socket.emit("endGame", { code: view.code });
  };
  return (
    <section className="adminbar">
      <strong>Admin hote</strong>
      {view.phase !== "GAME_OVER" && <button onClick={() => socket.emit("adminNext", { code: view.code })}>Debloquer la phase</button>}
      {view.phase !== "LOBBY" && view.phase !== "GAME_OVER" && <button className="danger" onClick={confirmEndGame}>Mettre fin a la partie</button>}
      {view.phase === "GAME_OVER" && <button className="primary" onClick={() => socket.emit("returnToLobby", { code: view.code })}>Retour au lobby</button>}
      {view.gameLog && <details><summary>Journal</summary><GameLog entries={view.gameLog} /></details>}
    </section>
  );
}

function GameLog({ entries }: { entries: NonNullable<RoomView["gameLog"]> }) {
  return <div className="game-log">{entries.slice(-12).map((entry) => <p key={`${entry.at}-${entry.message}`}><span>{new Date(entry.at).toLocaleTimeString()}</span> {entry.message}</p>)}</div>;
}

function AudioPanel({ view, audio }: { view: RoomView; audio: ReturnType<typeof useIntegratedAudio> }) {
  const you = view.you;
  const muted = view.players.find((player) => player.id === you?.id)?.muted ?? false;
  if (!you) return null;
  return (
    <div className="audio">
      <h2><Shield size={18} /> Audio</h2>
      <p>{view.audioMode === "external" ? "Audio externe selectionne. Utilisez WhatsApp, Discord ou un autre canal." : you.canHearAudio ? "Audio integre actif selon les permissions serveur." : "Audio coupe pour cette phase."}</p>
      {view.audioMode === "integrated" && (
        <>
          <div className="actions-row audio-actions">
            <button disabled={!you.canHearAudio || audio.permission === "requesting"} onClick={audio.enabled ? audio.stopAudio : audio.startAudio}>
              {audio.enabled ? <MicOff size={17} /> : <Mic size={17} />} {audio.enabled ? "Couper audio" : "Activer mon micro"}
            </button>
            <button disabled={!you.canHearAudio || !audio.enabled} onClick={() => socket.emit("setMuted", { code: view.code, playerId: you.id, muted: !muted })}>
              {muted ? <MicOff size={17} /> : <Mic size={17} />} {muted ? "Unmute" : "Mute"}
            </button>
          </div>
          <small>{audioStatusText(audio, muted, you.canSpeak)}</small>
        </>
      )}
    </div>
  );
}

function TransitionBanner({ transition }: { transition: NonNullable<RoomView["transition"]> }) {
  const isNight = transition === "night-falls";
  return <section className="transition-banner">{isNight ? <Moon /> : <Sun />}<h2>{isNight ? "La nuit tombe..." : "Le jour se leve..."}</h2></section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function StatusPill({ view, timer }: { view: RoomView; timer?: TimerInfo }) {
  return (
    <div className="status">
      <span>{phaseLabel(view.phase)}</span>
      <span>Tour {view.round}</span>
      {timer && <span className={timer.urgent ? "urgent" : ""}><Clock size={15} /> {timer.label} - {formatSeconds(timer.secondsLeft)}</span>}
    </div>
  );
}

function PhaseTimer({ timer, compact = false }: { timer: TimerInfo; compact?: boolean }) {
  return (
    <div className={timer.urgent ? `phase-timer urgent ${compact ? "compact" : ""}` : `phase-timer ${compact ? "compact" : ""}`}>
      <div>
        <span>{timer.label}</span>
        <strong>{formatSeconds(timer.secondsLeft)} restantes</strong>
      </div>
      <div className="timer-track" aria-hidden="true">
        <div style={{ width: `${timer.progress}%` }} />
      </div>
    </div>
  );
}

function ActionBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="content"><h2>{title}</h2>{children}</div>;
}

function SelectTarget({ value, onChange, players }: { value: string; onChange: (value: string) => void; players: RoomView["players"] }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Choisir un joueur</option>
      {players.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}
    </select>
  );
}

function persist(view: RoomView) {
  if (view.you?.sessionId) localStorage.setItem(sessionKey, view.you.sessionId);
  localStorage.setItem(roomKey, view.code);
}

function currentPlayer(view: RoomView) {
  return view.players.find((player) => player.id === view.you?.id);
}

function getTimerInfo(view: RoomView, now: number): TimerInfo | undefined {
  if (!view.timerEndsAt || !view.timerStartedAt || !view.timerDuration) return undefined;
  const secondsLeft = Math.max(0, Math.ceil((view.timerEndsAt - now) / 1000));
  const elapsed = Math.max(0, now - view.timerStartedAt);
  const totalMs = Math.max(1, view.timerDuration * 1000);
  const progress = Math.max(0, Math.min(100, 100 - (elapsed / totalMs) * 100));
  return {
    label: timerLabel(view),
    secondsLeft,
    duration: view.timerDuration,
    progress,
    urgent: secondsLeft <= Math.max(10, Math.ceil(view.timerDuration * 0.15))
  };
}

function timerLabel(view: RoomView) {
  if (view.phase === "MAYOR_NOMINATION") return "Nominations Maire";
  if (view.phase === "MAYOR_ELECTION") return "Election du Maire";
  if (view.phase === "NIGHT") return view.activeRole ? `${ROLE_LABELS[view.activeRole]}` : "Action de nuit";
  if (view.phase === "DEBATE") return "Debat";
  if (view.phase === "NOMINATION") return "Nominations";
  if (view.phase === "DEFENSE") {
    const speaker = view.players.find((player) => player.id === view.activePlayerId);
    return `Defense${speaker ? ` de ${speaker.name}` : ""}`;
  }
  if (view.phase === "VOTING") return "Vote";
  if (view.phase === "RESULT") return "Prochaine phase";
  return phaseLabel(view.phase);
}

function canHearRemote(view: RoomView, fromPlayerId: string) {
  if (view.audioMode !== "integrated" || !view.you?.canHearAudio || !view.you.audioPeerIds.includes(fromPlayerId)) return false;
  if (view.phase === "LOBBY") return true;
  if (view.phase === "NIGHT") return view.currentNightStep === "infiltres" && view.you.role === "Infiltre";
  if (view.phase === "DEFENSE") return view.activePlayerId === fromPlayerId;
  if (["MAYOR_NOMINATION", "MAYOR_ELECTION", "DAY_ANNOUNCEMENT", "DEBATE", "NOMINATION", "DEFENSE_REQUESTS", "VOTING", "RESULT"].includes(view.phase)) return true;
  return false;
}

function audioStatusText(audio: ReturnType<typeof useIntegratedAudio>, muted: boolean, canSpeak: boolean) {
  if (audio.permission === "requesting") return "Demande de permission micro...";
  if (audio.permission === "unsupported") return "Navigateur non compatible avec l'audio integre.";
  if (audio.permission === "missing") return "Aucun micro detecte.";
  if (audio.permission === "denied") return "Micro refuse par le navigateur.";
  if (!audio.enabled) return "Le micro n'est pas connecte.";
  if (muted || !canSpeak) return "Micro connecte, parole coupee par les regles.";
  return `Micro ouvert. Pairs audio : ${audio.activePeers}.`;
}

function phaseLabel(phase: RoomView["phase"] | string) {
  const labels: Partial<Record<string, string>> = {
    LOBBY: "Lobby",
    ROLE_DISTRIBUTION: "Distribution",
    MAYOR_NOMINATION: "Nominations Maire",
    MAYOR_ELECTION: "Election Maire",
    NIGHT: "Nuit",
    DAY_ANNOUNCEMENT: "Annonce jour",
    DEBATE: "Debat",
    NOMINATION: "Nominations",
    DEFENSE_REQUESTS: "Demandes defense",
    DEFENSE: "Defense",
    VOTING: "Vote",
    RESULT: "Resultat",
    GAME_OVER: "Fin"
  };
  return labels[phase] ?? `Phase ${phase}`;
}

function adminStatusLabel(status: AdminRoomSummary["status"]) {
  const labels: Record<AdminRoomSummary["status"], string> = {
    lobby: "lobby",
    inGame: "partie en cours",
    finished: "terminee"
  };
  return labels[status];
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function playAmbienceCue(kind: RoomView["phase"] | NonNullable<RoomView["transition"]>) {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const isNight = kind === "night-falls" || kind === "NIGHT";
  oscillator.type = isNight ? "sine" : "triangle";
  oscillator.frequency.setValueAtTime(isNight ? 130 : 260, context.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(isNight ? 82 : 390, context.currentTime + 0.75);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.035, context.currentTime + 0.08);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.9);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.95);
  window.setTimeout(() => void context.close(), 1200);
}

createRoot(document.getElementById("root")!).render(<App />);
