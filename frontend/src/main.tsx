import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import { ArrowLeft, Clock, Copy, Crown, Eye, Gavel, Lock, LogOut, Mic, MicOff, Moon, Play, RefreshCw, Settings, Shield, Sun, Trash2, Users, Volume2, VolumeX, Vote } from "lucide-react";
import type { AdminRoomDetails, AdminRoomSummary, BotRoomConfig, ClientToServerEvents, GameConfig, Role, RoomView, ServerSettings, ServerToClientEvents } from "@les-infiltres/shared";
import { DEFAULT_BOT_CONFIG, DEFAULT_CONFIG, ROLE_ABILITIES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, mergeBotConfig, mergeConfig } from "@les-infiltres/shared";
import "./styles.css";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type RtcSignal = RTCSessionDescriptionInit | RTCIceCandidateInit;
type PeerEntry = {
  connection: RTCPeerConnection;
  audio?: HTMLAudioElement;
};
type AudioPermission = "idle" | "requesting" | "granted" | "denied" | "missing" | "unsupported";
type BotAudioStatus = "disabled" | "enabled" | "speaking" | "error";
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
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

// Les voix de la synthèse vocale se chargent de façon asynchrone : on les met en cache
// et on rafraîchit le cache quand le navigateur signale qu'elles sont disponibles.
let narratorVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const loadVoices = () => {
    narratorVoices = window.speechSynthesis.getVoices();
  };
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

// Synthèse serveur (Azure) optionnelle : activée selon la config serveur, sinon
// on retombe sur la voix du navigateur.
let narratorTtsEnabled = false;
let narrationAudio: HTMLAudioElement | null = null;

function App() {
  const [view, setView] = useState<RoomView | null>(null);
  const [toast, setToast] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [audioMode, setAudioMode] = useState<"integrated" | "external">("external");
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [botConfig, setBotConfig] = useState<BotRoomConfig>(DEFAULT_BOT_CONFIG);
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
    socket.emit("getServerSettings", (settings) => {
      setServerSettings(settings);
      setBotConfig(settings.botAi.defaults);
      narratorTtsEnabled = settings.narratorTts?.enabled ?? false;
    });
    return () => {
      socket.off("roomState");
      socket.off("toast");
      socket.off("roomClosed", leaveRoom);
    };
  }, []);

  const create = () => {
    if (!name.trim()) return setToast("Entrez votre nom.");
    socket.emit("createRoom", { name, audioMode, config, botConfig, sessionId: localStorage.getItem(sessionKey) ?? undefined }, (next) => {
      persist(next);
      setView(next);
    });
  };

  const join = () => {
    if (!name.trim() || !code.trim()) return setToast("Entrez votre nom et le code.");
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
          <span className="eyebrow">Rôles cachés et débat public</span>
          <h1>Les Infiltrés</h1>
          <p>Le serveur distribue les rôles, verrouille les secrets, gère les pouvoirs et vérifie automatiquement la victoire.</p>
        </section>
        <section className="entry">
          <label>
            Nom
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Aubin" maxLength={32} />
          </label>
          <div className="mode">
            <button className={audioMode === "external" ? "selected" : ""} onClick={() => setAudioMode("external")}>Audio externe</button>
            <button className={audioMode === "integrated" ? "selected" : ""} onClick={() => setAudioMode("integrated")}>Audio intégré (MVP)</button>
          </div>
          <ConfigEditor config={config} onChange={setConfig} compact />
          {serverSettings?.botAi.enabled && <BotConfigEditor config={botConfig} onChange={setBotConfig} maxPerRoom={serverSettings.botAi.maxPerRoom} />}
          <button className="primary" onClick={create}><Play size={18} /> Créer une partie</button>
          <div className="join">
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CODE" maxLength={5} />
            <button onClick={join}>Rejoindre</button>
          </div>
          <button className="admin-link" onClick={() => setAdminOpen(true)}><Lock size={16} /> Administration</button>
          {toast && <p className="toast">{toast}</p>}
          <p className="muted">Le choix audio ne bloque jamais la création du salon. Le micro se teste après création, dans le lobby.</p>
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
    if (!window.confirm(`Supprimer le salon ${room.code} ? Tous les joueurs seront renvoyés à l'accueil.`)) return;
    socket.emit("adminDeleteRoom", { token, code: room.code }, (result) => {
      if (!result.ok) return setMessage(result.error);
      setMessage(`Salon ${room.code} supprimé.`);
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
            <button onClick={logout}><LogOut size={16} /> Déconnexion</button>
            <button onClick={onBack}><ArrowLeft size={16} /> Accueil</button>
          </div>
        </div>
        {message && <p className="toast">{message}</p>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Hôte</th>
                <th>Joueurs</th>
                <th>Statut</th>
                <th>Audio</th>
                <th>Bots IA</th>
                <th>Création</th>
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
                  <td>{room.audioMode === "integrated" ? "intégré" : "externe"}</td>
                  <td>{room.botAi.enabled && room.botAi.config.enabled ? `${room.botAi.config.count}${room.botAi.config.autoFill ? " + auto" : ""}` : "off"}</td>
                  <td>{new Date(room.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="admin-actions">
                      <button onClick={() => showDetails(room.code)}><Eye size={16} /> Voir détails</button>
                      <button className="danger" onClick={() => deleteRoom(room)}><Trash2 size={16} /> Supprimer</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rooms.length && (
                <tr>
                  <td colSpan={8}>Aucun salon actif.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {details && (
          <div className="admin-details">
            <h2>Détails du salon {details.code}</h2>
            <p>Phase : {phaseLabel(details.phase)} - Tour {details.round}</p>
            <p>Bots IA : {details.botAi.enabled && details.botAi.config.enabled ? `actifs, ${details.botAi.config.count} bot(s), participation ${participationLabel(details.botAi.config.participation)}` : "désactivés"}</p>
            <div className="players">
              {details.players.map((player) => (
                <div className={`player ${player.alive ? "" : "out"}`} key={player.id}>
                  <span>{player.name}{player.isBot ? " - IA" : ""}{player.isHost ? " - Hôte" : ""}{player.isMayor ? " - Maire" : ""}</span>
                  <small>{player.connected ? "en ligne" : "déconnecté"} - {player.alive ? "en jeu" : "éliminé"}{player.botVoice ? ` - voix ${player.botVoice.voiceName}` : ""}</small>
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
  const botVoice = useBotVoice(view, onToast);
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
    if (!voiceEnabled) return;
    speakNarration(view.narrator, view.phase, view.transition);
  }, [voiceEnabled, view.narrator]);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    localStorage.setItem("les-infiltres-voice", next ? "on" : "off");
    if (!next) stopNarration();
  };
  const quit = () => {
    const label = view.phase === "LOBBY" ? "Quitter le salon" : "Quitter la partie";
    const hostLobby = view.phase === "LOBBY" && !!you?.isHost;
    const message = hostLobby
      ? "Vous êtes l'hôte. Quitter transférera le salon au prochain joueur, ou fermera le salon si vous êtes seul. Continuer ?"
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
        {you && !you.alive && <p className="spectator-line">Vous êtes emprisonné. Vous ne pouvez plus agir dans la partie, mais vous pouvez continuer à discuter.</p>}
        {toast && <p className="toast">{toast}</p>}
      </section>

      <div className="layout">
        <section className="panel main-panel">
          <PhaseIntro view={view} />
          <PhaseContent view={view} timer={timer} onLeaveRoom={onLeaveRoom} />
          {view.phase !== "LOBBY" && view.phase !== "GAME_OVER" && <ChatPanel view={view} />}
        </section>

        <aside className="panel side-panel">
          <AudioPanel view={view} audio={audio} botVoice={botVoice} />
          <h2><Users size={18} /> Joueurs</h2>
          <div className="players">
            {view.players.map((player) => (
              <div className={`player ${player.alive ? "" : "out"} ${player.speaking ? "speaking" : ""} ${player.audioActive ? "audio-active" : ""}`} key={player.id}>
                <span>{player.name}{player.isBot ? " - IA" : ""}{player.isMayor ? " - Maire" : ""}{player.isHost ? " - Hôte" : ""}</span>
                <small>
                  {player.connected ? "en ligne" : "déconnecté"}
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
  const canAct = view.you?.alive !== false;
  return (
    <>
      {view.phase === "LOBBY" && <Lobby view={view} />}
      {view.phase === "MAYOR_NOMINATION" && (canAct ? <MayorNomination view={view} /> : <SpectatorPhasePanel view={view} />)}
      {view.phase === "MAYOR_ELECTION" && (canAct ? <MayorElection view={view} /> : <SpectatorPhasePanel view={view} />)}
      {view.phase !== "LOBBY" && view.you && <RoleCard view={view} />}
      {view.phase === "NIGHT" && (canAct ? <NightPanel view={view} /> : <SpectatorPhasePanel view={view} />)}
      {["DAY_ANNOUNCEMENT", "DEBATE", "DEFENSE"].includes(view.phase) && <DebatePanel view={view} timer={timer} />}
      {view.phase === "NOMINATION" && (canAct ? <NominationPanel view={view} /> : <SpectatorPhasePanel view={view} />)}
      {view.phase === "DEFENSE_REQUESTS" && <DefenseRequestsPanel view={view} />}
      {view.phase === "VOTING" && (canAct ? <VotePanel view={view} /> : <SpectatorPhasePanel view={view} />)}
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

function SpectatorPhasePanel({ view }: { view: RoomView }) {
  return (
    <div className="content spectator-panel">
      <h2>Spectateur</h2>
      <p>Vous êtes emprisonné. Vous ne pouvez plus agir dans la partie, mais vous pouvez continuer à discuter.</p>
      {view.phase === "MAYOR_NOMINATION" && <PublicVoteBoard title="Nominations Maire publiques" emptyText="Aucune candidature proposée." details={view.mayorNominationDetails} totals={view.mayorNominationTotals} verb="propose" />}
      {view.phase === "MAYOR_ELECTION" && <PublicVoteBoard title="Votes du Maire" emptyText="Aucun vote enregistré." details={view.mayorVoteDetails} totals={view.mayorVoteTotals} verb="vote pour" />}
      {["NOMINATION", "DEFENSE_REQUESTS", "DEFENSE", "VOTING"].includes(view.phase) && <PublicVoteBoard title="Nominations publiques" emptyText="Aucune nomination enregistrée." details={view.nominationDetails} totals={view.nominationTotals} verb="nomine" />}
      {view.phase === "VOTING" && <PublicVoteBoard title="Votes publics" emptyText="Aucun vote enregistré." details={view.voteDetails} totals={view.voteTotals} verb="vote contre" weighted />}
      {view.phase === "NIGHT" && <p className="muted">La nuit est confidentielle. Vous pourrez reprendre le canal principal au retour du jour.</p>}
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
    body: "Les joueurs vivants proposent publiquement les candidats au poste de Maire. Vous pouvez modifier votre nomination jusqu'à la fin du chrono.",
    short: "Nominations Maire : proposez ou modifiez votre candidat."
  };
  if (view.phase === "MAYOR_ELECTION") return {
    title: "Vote du Maire",
    body: "Votez uniquement parmi les candidats nominés. Le joueur avec le plus de voix devient Maire et gérera la parole.",
    short: "Vote Maire : choisissez parmi les candidats verrouillés."
  };
  if (view.phase === "DEBATE") return {
    title: "Débat",
    body: "Pendant cette phase, les joueurs débattent afin d'identifier les suspects. Le Maire peut laisser la parole libre ou verrouiller les micros.",
    short: "Débat : discutez, sauf si le Maire verrouille la parole."
  };
  if (view.phase === "NOMINATION") return {
    title: "Nomination",
    body: "Choisissez les joueurs que vous souhaitez voir passer au vote. Les nominations sont publiques et modifiables jusqu'à la fin du chrono.",
    short: "Nominations : désignez les suspects."
  };
  if (view.phase === "DEFENSE_REQUESTS" || view.phase === "DEFENSE") return {
    title: "Défense",
    body: "Les joueurs nominés peuvent demander au Maire l'autorisation de se défendre avant le vote.",
    short: "Défense : les nominés demandent la parole au Maire."
  };
  if (view.phase === "VOTING") return {
    title: "Vote",
    body: "Votez publiquement parmi les joueurs nominés. Les bonus du Sage et du Maire sont comptés au dépouillement.",
    short: "Vote : choisissez parmi les nominés."
  };
  if (view.phase === "NIGHT" && view.currentNightStep === "infiltres") return {
    title: "Phase Infiltrés",
    body: "Les Infiltrés choisissent secrètement leur cible. Les autres joueurs voient des états audio neutralisés, sauf la Guetteuse qui peut observer au risque de s'exposer.",
    short: "Infiltrés : cible secrète, états audio masqués."
  };
  if (view.phase === "NIGHT" && view.activeRole === "Hackeuse") return {
    title: "Hackeuse",
    body: "La Hackeuse peut enquêter sur un joueur et découvrir secrètement son rôle.",
    short: "Hackeuse : enquêtez sur un joueur."
  };
  if (view.phase === "NIGHT") return {
    title: "Nuit",
    body: "Les rôles se réveillent un par un. Le joueur concerné peut agir ou terminer son tour sans attendre la fin du chrono.",
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
  const recognitionRef = useRef<SpeechRecognitionLike | undefined>(undefined);
  const lastActivityRef = useRef(false);

  viewRef.current = view;

  const stopAudio = () => {
    if (activityFrameRef.current) window.cancelAnimationFrame(activityFrameRef.current);
    activityFrameRef.current = undefined;
    void audioContextRef.current?.close();
    audioContextRef.current = undefined;
    recognitionRef.current?.stop();
    recognitionRef.current = undefined;
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

  const startSpeechRecognition = () => {
    const typedWindow = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const Recognition = typedWindow.SpeechRecognition ?? typedWindow.webkitSpeechRecognition;
    if (!Recognition) {
      console.info("realtime disconnected", "browser transcription unavailable");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "fr-FR";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      const text = result?.[0]?.transcript?.trim();
      if (!result?.isFinal || !text) return;
      console.info("transcription received", text);
      socket.emit("audioTranscript", { code: viewRef.current.code, text });
    };
    recognition.onerror = (event) => console.warn("realtime disconnected", event);
    recognition.onend = () => console.info("realtime disconnected", "speech recognition ended");
    recognitionRef.current = recognition;
    try {
      recognition.start();
      console.info("realtime connected", "browser speech recognition");
    } catch (error) {
      console.warn("realtime disconnected", error);
    }
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
      void entry.audio.play()
        .then(() => console.info("audio playback started"))
        .catch((error) => {
          console.warn("audio playback error", error);
          onToast("Audio indisponible, réponse affichée en texte.");
        });
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
      onToast("Navigateur non compatible avec l'audio intégré.");
      return;
    }
    setPermission("requesting");
    console.info("microphone permission status", "requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        setPermission("missing");
        onToast("Aucun micro détecté.");
        return;
      }
      localStreamRef.current = stream;
      setEnabled(true);
      setPermission("granted");
      console.info("microphone permission status", "granted");
      console.info("speaker/audio context status", window.AudioContext ? "available" : "unavailable");
      startActivityMeter(stream);
      startSpeechRecognition();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        setPermission("missing");
        console.info("microphone permission status", "missing");
        onToast("Aucun micro détecté.");
      } else {
        setPermission("denied");
        console.info("microphone permission status", "denied");
        onToast("Permission micro refusée.");
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
    activePeers: peerCount,
    botListening: enabled && view.players.some((player) => player.isBot && player.alive)
  };
}

function useBotVoice(view: RoomView, onToast: (message: string) => void) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("les-infiltres-bot-voice") === "on");
  const [status, setStatus] = useState<BotAudioStatus>(enabled ? "enabled" : "disabled");
  const spokenIdsRef = useRef(new Set<string>());

  const enable = () => {
    localStorage.setItem("les-infiltres-bot-voice", "on");
    setEnabled(true);
    setStatus("enabled");
    console.info("speaker/audio context status", "bot voice enabled");
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance("Son des bots activé.");
      utterance.lang = "fr-FR";
      utterance.volume = 0.75;
      window.speechSynthesis.speak(utterance);
    } else {
      setStatus("error");
      onToast("Audio indisponible, réponse affichée en texte.");
    }
  };

  const disable = () => {
    localStorage.setItem("les-infiltres-bot-voice", "off");
    setEnabled(false);
    setStatus("disabled");
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };

  useEffect(() => {
    if (!enabled) return;
    const message = [...view.chatMessages].reverse().find((item) => item.isBot && !spokenIdsRef.current.has(item.id));
    if (!message) return;
    spokenIdsRef.current.add(message.id);
    console.info("bot response text received", { bot: message.playerName, text: message.text });
    if (!("speechSynthesis" in window)) {
      setStatus("error");
      onToast("Audio indisponible, réponse affichée en texte.");
      return;
    }
    try {
      console.info("bot audio chunk received", { source: "browser-speech-synthesis", bot: message.playerName });
      const utterance = new SpeechSynthesisUtterance(message.text);
      const voice = view.players.find((player) => player.id === message.playerId)?.botVoice;
      utterance.lang = "fr-FR";
      utterance.rate = voice?.speakingRate ?? botVoiceRate(message.playerName);
      utterance.pitch = voice?.pitch ?? botVoicePitch(message.playerName);
      utterance.volume = voice?.volume ?? 0.9;
      utterance.onstart = () => {
        console.info("audio playback started", { bot: message.playerName });
        setStatus("speaking");
      };
      utterance.onend = () => setStatus("enabled");
      utterance.onerror = (event) => {
        console.warn("audio playback error", event);
        setStatus("error");
        onToast("Audio indisponible, réponse affichée en texte.");
      };
      console.info("bot selected voice", { bot: message.playerName, voiceName: voice?.voiceName, style: voice?.voiceStyle });
      console.info("bot audio response received", { bot: message.playerName, voiceName: voice?.voiceName });
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("audio playback error", error);
      setStatus("error");
      onToast("Audio indisponible, réponse affichée en texte.");
    }
  }, [enabled, view.chatMessages, onToast]);

  return {
    enabled,
    status,
    enable,
    disable,
    speaking: status === "speaking" || view.players.some((player) => player.isBot && player.audioActive)
  };
}

function Lobby({ view }: { view: RoomView }) {
  const [draft, setDraft] = useState(view.config);
  const [botDraft, setBotDraft] = useState(view.botAi.config);
  const [editing, setEditing] = useState(false);
  const canStart = view.lobby.playerCount >= view.lobby.minPlayers;
  const maxBotsForRoom = Math.min(view.botAi.maxPerRoom, Math.max(0, view.lobby.maxPlayers - view.lobby.humanCount));
  const canAddMoreBots = view.botAi.enabled && view.botAi.config.enabled && view.lobby.botCount < maxBotsForRoom && view.lobby.playerCount < view.lobby.maxPlayers;

  useEffect(() => setDraft(view.config), [view.config]);
  useEffect(() => setBotDraft(view.botAi.config), [view.botAi.config]);

  const saveConfig = (next: GameConfig) => {
    setDraft(next);
    socket.emit("updateConfig", { code: view.code, config: next });
  };
  const saveBotConfig = (next: BotRoomConfig) => {
    setBotDraft(next);
    socket.emit("updateBotConfig", { code: view.code, botConfig: next });
  };
  const closeRoom = () => {
    if (window.confirm("Fermer le salon pour tous les joueurs ?")) socket.emit("closeRoom", { code: view.code });
  };
  const removeParticipant = (player: RoomView["players"][number]) => {
    if (!window.confirm(`Retirer ${player.name} du salon ?`)) return;
    socket.emit("removeParticipant", { code: view.code, playerId: player.id });
  };

  return (
    <div className="content">
      <h2>Lobby</h2>
      <div className="stats-grid">
        <Metric label="Humains" value={`${view.lobby.humanCount}`} />
        <Metric label="Bots" value={`${view.lobby.botCount}`} />
        <Metric label="Total" value={`${view.lobby.playerCount}`} />
        <Metric label="Max joueurs" value={`${view.lobby.maxPlayers}`} />
        <Metric label="Manquants" value={view.lobby.missingPlayers === 0 ? "Pret" : `${view.lobby.missingPlayers}`} />
        <Metric label="Infiltrés prévus" value={`${view.lobby.plannedInfiltrators}`} />
        <Metric label="Limite bots serveur" value={`${view.botAi.maxPerRoom}`} />
        <Metric label="Égalité" value={view.config.tieRule === "revote" ? "Revote" : "Aucun éliminé"} />
      </div>
      <div>
        <h3>Participants</h3>
        <div className="players lobby-players">
          {view.players.map((player) => (
            <div className="player" key={player.id}>
              <span>{player.name}{player.isBot ? " - IA" : ""}{player.isHost ? " - Hote" : ""}</span>
              <small>
                {player.isBot ? "bot ajouté" : player.connected ? "humain connecté" : "humain déconnecté"}
                {player.audioActive ? " - audio actif" : ""}
              </small>
              {view.you?.isHost && player.id !== view.you.id && (
                <div className="player-actions">
                  <button className="danger" onClick={() => removeParticipant(player)}><Trash2 size={16} /> Retirer</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3>Rôles potentiels</h3>
        <div className="chips">{view.lobby.potentialRoles.map((role) => <span key={role}>{ROLE_LABELS[role]}</span>)}</div>
      </div>
      {view.you?.isHost && (
        <div className="actions-row">
          <button onClick={() => setEditing((value) => !value)}>{editing ? "Retour au lobby" : "Modifier la configuration"}</button>
          <button className="danger" onClick={closeRoom}>Fermer le salon</button>
        </div>
      )}
      {view.you?.isHost && view.botAi.enabled && (
        <div className="bot-controls">
          <BotConfigEditor config={botDraft} onChange={saveBotConfig} maxPerRoom={maxBotsForRoom} serverMaxPerRoom={view.botAi.maxPerRoom} />
          {view.botAi.config.enabled && !canAddMoreBots && <p className="muted">Impossible d'ajouter plus de bots : limite serveur ou max joueurs atteint.</p>}
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
        <p className="muted">En attente du lancement par l'hôte.</p>
      )}
    </div>
  );
}

function BotConfigEditor({ config, onChange, maxPerRoom, serverMaxPerRoom = maxPerRoom, compact = false }: { config: BotRoomConfig; onChange: (config: BotRoomConfig) => void; maxPerRoom: number; serverMaxPerRoom?: number; compact?: boolean }) {
  const update = (patch: Partial<BotRoomConfig>) => {
    const next = mergeBotConfig({ ...config, ...patch });
    next.count = Math.min(next.count, maxPerRoom);
    onChange(next);
  };
  return (
    <div className={`config bot-config ${compact ? "compact" : ""}`}>
      <h3><Users size={16} /> Configuration des Bots IA</h3>
      <div className="config-grid">
        <ConfigField label="Bots IA" help="Active ou désactive les bots pour ce salon.">
          <label><input type="checkbox" checked={config.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Activer</label>
        </ConfigField>
        <ConfigField label="Nombre de bots" help={`Nombre de bots maintenus dans le lobby. Maximum actuel : ${maxPerRoom}. Maximum serveur : ${serverMaxPerRoom}.`}>
          <NumericConfigInput value={config.count} min={0} max={maxPerRoom} onCommit={(value) => update({ count: value })} />
        </ConfigField>
        <ConfigField label="Complétion auto" help="Ajoute ou retire automatiquement des bots pour atteindre le minimum de joueurs.">
          <label><input type="checkbox" checked={config.autoFill} onChange={(e) => update({ autoFill: e.target.checked })} /> Completer la room</label>
        </ConfigField>
        <ConfigField label="Participation" help="Fréquence et température des interventions IA.">
          <select value={config.participation} onChange={(e) => update({ participation: e.target.value as BotRoomConfig["participation"] })}>
            <option value="discreet">discret</option>
            <option value="normal">normal</option>
            <option value="talkative">talkative</option>
          </select>
        </ConfigField>
        <ConfigField label="Voix IA" help="Prépare la voix IA des bots. Le MVP reste texte si désactivé.">
          <label><input type="checkbox" checked={config.audioEnabled} onChange={(e) => update({ audioEnabled: e.target.checked })} /> Activer</label>
        </ConfigField>
        <ConfigField label="Temps réponse" help="Temps moyen avant qu'un bot agisse, en millisecondes.">
          <NumericConfigInput value={config.averageResponseMs} min={250} max={10000} step={250} onCommit={(value) => update({ averageResponseMs: value })} />
        </ConfigField>
      </div>
      {!compact && (
        <div className="toggles">
          <label><input type="checkbox" checked={config.allowMayor} onChange={(e) => update({ allowMayor: e.target.checked })} /> Bots candidats Maire</label>
          <label><input type="checkbox" checked={config.allowDebateSpeech} onChange={(e) => update({ allowDebateSpeech: e.target.checked })} /> Bots parlent en débat</label>
          <label><input type="checkbox" checked={config.allowAudio} onChange={(e) => update({ allowAudio: e.target.checked })} /> Bots utilisent l'audio</label>
        </div>
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
      <h3><Settings size={16} /> Configuration avancée</h3>
      <div className="config-grid">
        <ConfigField label="Max joueurs" help="Nombre maximum de joueurs autorisés dans la partie.">
          <NumericConfigInput value={config.maxPlayers} min={7} max={20} onCommit={(value) => update({ maxPlayers: value })} />
        </ConfigField>
        <ConfigField label="Égalité" help="Règle appliquée si un vote finit à égalité. Aucun éliminé signifie que personne n'est emprisonné.">
          <select value={config.tieRule} onChange={(e) => update({ tieRule: e.target.value === "revote" ? "revote" : "none" })}><option value="none">Aucun éliminé</option><option value="revote">Revote</option></select>
        </ConfigField>
        <ConfigField label="Élection du Maire" help="Durée en secondes de l'élection publique du Maire.">
          <NumericConfigInput value={config.durations.mayorElection} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, mayorElection: value } })} />
        </ConfigField>
        <ConfigField label="Action de nuit" help="Durée maximum en secondes pour chaque rôle appelé pendant la nuit.">
          <NumericConfigInput value={config.durations.nightAction} min={5} max={60} step={5} onCommit={(value) => update({ durations: { ...config.durations, nightAction: value } })} />
        </ConfigField>
        <ConfigField label="Débat" help="Durée en secondes du débat général pendant la journée.">
          <NumericConfigInput value={config.durations.freeDebate} min={15} max={3600} step={5} onCommit={(value) => update({ durations: { ...config.durations, freeDebate: value } })} />
        </ConfigField>
        <ConfigField label="Nominations" help="Durée en secondes de l'étape de nomination avant le vote.">
          <NumericConfigInput value={config.durations.nomination} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, nomination: value } })} />
        </ConfigField>
        <ConfigField label="Défense" help="Durée en secondes accordée à un joueur pour se défendre.">
          <NumericConfigInput value={config.durations.defense} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, defense: value } })} />
        </ConfigField>
        <ConfigField label="Vote" help="Durée en secondes de la phase de vote.">
          <NumericConfigInput value={config.durations.vote} min={10} max={600} step={5} onCommit={(value) => update({ durations: { ...config.durations, vote: value } })} />
        </ConfigField>
      </div>
      {!compact && (
        <>
          <div className="toggles">
            <label><input type="checkbox" checked={config.deadCanHearAudio} onChange={(e) => update({ deadCanHearAudio: e.target.checked })} /> Morts entendent l'audio</label>
            <label><input type="checkbox" checked={config.requireSpecialRoles} onChange={(e) => update({ requireSpecialRoles: e.target.checked })} /> Rôles spéciaux obligatoires</label>
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
        <button className={audioMode === "integrated" ? "selected" : ""} onClick={() => socket.emit("updateAudioMode", { code, audioMode: "integrated" })}>Audio intégré</button>
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
      <p>Proposez publiquement les candidats au poste de Maire. Le dernier choix remplace le précédent jusqu'à la fin du chrono.</p>
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
      <PublicVoteBoard title="Nominations Maire publiques" emptyText="Aucune candidature proposée." details={view.mayorNominationDetails} totals={view.mayorNominationTotals} verb="propose" />
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
      <h2>Élection du Maire</h2>
      <p>Le Maire est une fonction publique, distincte des rôles secrets. Le vote est limité aux candidats nominés.</p>
      <PublicVoteBoard title="Candidats Maire verrouillés" emptyText="Aucun candidat verrouillé." details={view.mayorNominationDetails} totals={view.mayorNominationTotals} verb="a propose" />
      <p>{view.mayorVotes.length} vote(s) enregistrés.</p>
      {canVote && <SelectTarget value={targetId} onChange={(value) => {
        setTargetId(value);
        if (value) socket.emit("electMayor", { code: view.code, targetId: value });
      }} players={candidates} />}
      <button className="primary" disabled={!targetId || !canVote} onClick={() => socket.emit("electMayor", { code: view.code, targetId })}>
        <Crown size={18} /> {ownVote ? "Changer mon vote" : "Voter pour le Maire"}
      </button>
      {ownVote && <p className="muted">Votre vote actuel : <strong>{ownVote.targetName}</strong>.</p>}
      {!canVote && <p className="muted">Vous observez l'élection sans voter.</p>}
      <PublicVoteBoard title="Votes du Maire" emptyText="Aucun vote enregistré." details={view.mayorVoteDetails} totals={view.mayorVoteTotals} verb="vote pour" />
    </div>
  );
}

function RoleCard({ view }: { view: RoomView }) {
  const role = view.you?.role;
  if (!role) return null;
  return (
    <div className="role-card">
      <div className="role-card-meta">
        <span>Votre rôle secret</span>
        {view.you?.isMayor && <span className="role-badge"><Crown size={14} /> Maire</span>}
      </div>
      <h2>{ROLE_LABELS[role]}</h2>
      <p>{ROLE_DESCRIPTIONS[role]}</p>
      <ul className="ability-list">
        {ROLE_ABILITIES[role].map((ability) => <li key={ability}>{ability}</li>)}
      </ul>
      {view.you?.powerStatuses.map((power) => (
        <small className={power.used ? "used-power" : ""} key={power.key}>{power.label} : {power.used ? "Pouvoir déjà utilisé" : "Disponible"}</small>
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
        <h2>Dormez…</h2>
        <p>{view.you?.nightChannel === "sleep" ? "Votre rôle n'agit pas maintenant." : "Vous observez la partie sans interaction."}</p>
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
        <p>Vous observez discrètement l'étape des Infiltrés. Les informations utiles apparaissent dans votre carte de rôle.</p>
      </ActionBlock>
    );
  }

  const targets = view.currentNightStep === "avocate" ? allAlive : aliveTargets;
  return (
    <ActionBlock title={view.currentNightStep === "infiltres" ? "Communication des Infiltrés" : "Action de nuit"}>
      <PowerNotice view={view} />
      <SelectTarget value={targetId} onChange={setTargetId} players={targets} />
      {view.currentNightStep === "infiltres" && <p className="muted">Seuls les Infiltrés voient cette interface et désignent une victime commune.</p>}
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
      <h3>Choix des Infiltrés</h3>
      {votes.length ? (
        votes.map((vote) => <p key={vote.voterId}><strong>{vote.voterName}</strong> cible <strong>{vote.targetName}</strong></p>)
      ) : (
        <p className="muted">Aucun choix enregistré.</p>
      )}
      {view.infiltratorVoteLeader && <p>Total actuel : <strong>{view.infiltratorVoteLeader.targetName}</strong> ({view.infiltratorVoteLeader.total})</p>}
    </div>
  );
}

function PowerNotice({ view }: { view: RoomView }) {
  const used = view.you?.powerStatuses.filter((power) => power.used) ?? [];
  if (!used.length) return null;
  return <p className="used-power">Pouvoir déjà utilisé : {used.map((power) => power.label).join(", ")}</p>;
}

function ChatPanel({ view }: { view: RoomView }) {
  const [text, setText] = useState("");
  const me = currentPlayer(view);
  const canChat = !!view.you?.canSpeak && !me?.muted && !(view.phase === "NIGHT" && view.you.role !== "Infiltre");
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
          <p key={message.id} className={`${message.scope === "infiltres" ? "private-message" : ""} ${message.isBot ? "bot-message" : ""}`}>
            <strong>{message.playerName}</strong> {message.isBot ? <span>IA</span> : null} {message.scope === "infiltres" ? <span>Infiltres</span> : null}
            {message.text}
          </p>
        )) : <p className="muted">Aucun message visible.</p>}
        {view.botThinking.map((name) => <p key={name} className="bot-thinking"><strong>{name}</strong> réfléchit…</p>)}
      </div>
      {canChat && (
        <form className="chat-form" onSubmit={submit}>
          <input value={text} onChange={(event) => setText(event.target.value)} maxLength={280} placeholder="Écrire un message" />
          <button>Envoyer</button>
        </form>
      )}
    </div>
  );
}

function DebatePanel({ view, timer }: { view: RoomView; timer?: TimerInfo }) {
  const speaker = view.players.find((player) => player.id === view.activePlayerId);
  const isOwnDefense = view.phase === "DEFENSE" && !!view.you && speaker?.id === view.you.id;
  return (
    <div className="content">
      <h2>{view.phase === "DAY_ANNOUNCEMENT" ? "Le jour se lève" : view.phase === "DEFENSE" ? "Défense individuelle" : "Débat en cours"}</h2>
      <p>{view.phase === "DEFENSE" && speaker ? <>Défense de <strong>{speaker.name}</strong> en cours…</> : <>Joueur qui parle : <strong>{speaker?.name ?? "discussion libre"}</strong></>}</p>
      {view.phase === "DEFENSE" && speaker && <p className="muted">{speaker.name} peut terminer sa défense avant la fin du chrono.</p>}
      {isOwnDefense && (
        <button className="primary" onClick={() => socket.emit("finishDefense", { code: view.code, participantId: speaker.id })}>
          <Gavel size={18} /> Terminer ma défense
        </button>
      )}
      {timer ? <PhaseTimer timer={timer} compact /> : <p>Temps restant : <strong>non chronométré</strong></p>}
      {!view.you?.isMayor && <p className="muted">Le Maire contrôle la parole et le passage au vote.</p>}
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
      <p>Chaque joueur vivant peut nominer un suspect. Le dernier choix remplace le précédent jusqu'à la fin du chrono.</p>
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
        <p className="muted">Vous êtes emprisonné : vous observez les nominations sans participer.</p>
      )}
      <PublicVoteBoard title="Nominations publiques" emptyText="Aucune nomination enregistrée." details={view.nominationDetails} totals={view.nominationTotals} verb="nomine" />
    </div>
  );
}

function DefenseRequestsPanel({ view }: { view: RoomView }) {
  const requested = view.defenseRequests.find((request) => request.playerId === view.you?.id);
  const isNominee = !!view.you?.alive && view.nominees.includes(view.you.id);
  const nomineePlayers = view.players.filter((player) => view.nominees.includes(player.id));
  return (
    <div className="content">
      <h2>Demandes de défense</h2>
      <p>Liste finale des nominés : <strong>{nomineePlayers.map((player) => player.name).join(", ")}</strong>.</p>
      <PublicVoteBoard title="Nominations verrouillées" emptyText="Aucun nominé." details={view.nominationDetails} totals={view.nominationTotals} verb="a nomine" />
      {isNominee ? (
        <div className="defense-request-card">
          <p>Vous êtes nominé. Vous pouvez demander au Maire de vous accorder un temps de défense.</p>
          <button className="primary" disabled={!!requested} onClick={() => socket.emit("requestDefense", { code: view.code })}>
            <Gavel size={18} /> Demander à se défendre
          </button>
          {requested && <p className="muted">Demande {defenseRequestStatusLabel(requested.status)}.</p>}
        </div>
      ) : (
        <p className="muted">{view.you?.alive ? "Seuls les joueurs nominés peuvent demander une défense." : "Vous êtes emprisonné : vous observez les défenses sans participer."}</p>
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
      <p>{view.votes.length} vote(s) enregistrés. Le vote est limité aux joueurs nominés. Le Sage vaut 2 voix. Le Maire ajoute +1 voix.</p>
      <PublicVoteBoard title="Nominations verrouillées" emptyText="Aucun nominé." details={view.nominationDetails} totals={view.nominationTotals} verb="a nomine" />
      {canVote ? (
        <>
          <SelectTarget value={targetId} onChange={setTargetId} players={targets} />
          <button className="primary" disabled={!targetId} onClick={() => socket.emit("vote", { code: view.code, targetId })}><Vote size={18} /> {ownVote ? "Changer mon vote" : "Voter"}</button>
          {ownVote && <p className="muted">Votre vote actuel : <strong>{ownVote.targetName}</strong>.</p>}
        </>
      ) : (
        <p className="muted">Vous êtes emprisonné : vous observez le vote sans participer.</p>
      )}
      <PublicVoteBoard title="Votes publics" emptyText="Aucun vote enregistré." details={view.voteDetails} totals={view.voteTotals} verb="vote contre" weighted />
    </div>
  );
}

function DefenseRequestBoard({ requests }: { requests: RoomView["defenseRequests"] }) {
  return (
    <div className="vote-ledger">
      <h3>Demandes reçues</h3>
      {requests.length ? (
        requests.map((request) => (
          <p key={request.playerId}>
            <strong>{request.playerName}</strong> : {defenseRequestStatusLabel(request.status)}
          </p>
        ))
      ) : (
        <p className="muted">Aucune demande de défense pour l'instant.</p>
      )}
    </div>
  );
}

function defenseRequestStatusLabel(status: RoomView["defenseRequests"][number]["status"]) {
  const labels: Record<RoomView["defenseRequests"][number]["status"], string> = {
    pending: "en attente",
    granted: "accordée",
    refused: "passee",
    done: "terminée"
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
      <h2>Résultat</h2>
      <p>{view.lastResult}</p>
      {view.you?.isHost && <p className="muted">L'hôte peut débloquer le retour à la nuit avec son panneau admin.</p>}
    </div>
  );
}

function EndPanel({ view, onLeaveRoom }: { view: RoomView; onLeaveRoom: () => void }) {
  return (
    <div className="content">
      <h2>Fin de partie</h2>
      {view.winner ? <p>Victoire : <strong>{view.winner}</strong></p> : <p><strong>Partie terminée par l'hôte.</strong></p>}
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
    if (window.confirm("Clôturer le débat et passer aux nominations ?")) socket.emit("closeDebate", { code: view.code });
  };
  return (
    <section className="hostbar mayorbar">
      <strong><Crown size={17} /> Panneau Maire</strong>
      {timer && <span className={timer.urgent ? "timer-inline urgent" : "timer-inline"}>{timer.label} : {formatSeconds(timer.secondsLeft)}</span>}
      {(view.phase === "DAY_ANNOUNCEMENT" || view.phase === "DEBATE") && (
        <>
          <select value={speechPlayer} onChange={(event) => setSpeechPlayer(event.target.value)}>{alivePlayers.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select>
          <button onClick={() => socket.emit("startDebate", { code: view.code })}>Débat global</button>
          <button disabled={!speechPlayer} onClick={() => socket.emit("grantSpeech", { code: view.code, playerId: speechPlayer })}>Donner parole</button>
          <button onClick={() => socket.emit("stopSpeech", { code: view.code })}>Couper</button>
        </>
      )}
      {view.phase === "DEFENSE" && <button onClick={() => socket.emit("stopSpeech", { code: view.code })}>Arrêter la défense</button>}
      {["DAY_ANNOUNCEMENT", "DEBATE"].includes(view.phase) ? (
        <button onClick={closeDebate}>Passer aux nominations</button>
      ) : view.phase === "DEFENSE_REQUESTS" ? (
        <button onClick={() => socket.emit("startVote", { code: view.code })}>Passer au vote</button>
      ) : view.phase === "DEFENSE" ? (
        <button disabled>Défense en cours</button>
      ) : (
        <button disabled={view.phase !== "NOMINATION"} onClick={() => socket.emit("startVote", { code: view.code })}>Clôturer les nominations</button>
      )}
      <span>{speaker ? `Parle : ${speaker.name}` : "Parole libre"}</span>
      {view.phase === "DEFENSE_REQUESTS" && (
        <div className="mayor-defense-requests">
          {pendingDefenseRequests.length ? pendingDefenseRequests.map((request) => (
            <span key={request.playerId}>
              {request.playerName}
              <button onClick={() => socket.emit("grantSpeech", { code: view.code, playerId: request.playerId })}>Accorder la défense</button>
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
    if (window.confirm("Mettre fin à la partie pour tous les joueurs ?")) socket.emit("endGame", { code: view.code });
  };
  return (
    <section className="adminbar">
      <strong>Admin hote</strong>
      {view.phase !== "GAME_OVER" && <button onClick={() => socket.emit("adminNext", { code: view.code })}>Débloquer la phase</button>}
      {view.phase !== "LOBBY" && view.phase !== "GAME_OVER" && <button className="danger" onClick={confirmEndGame}>Mettre fin à la partie</button>}
      {view.phase === "GAME_OVER" && <button className="primary" onClick={() => socket.emit("returnToLobby", { code: view.code })}>Retour au lobby</button>}
      {view.gameLog && <details><summary>Journal</summary><GameLog entries={view.gameLog} /></details>}
    </section>
  );
}

function GameLog({ entries }: { entries: NonNullable<RoomView["gameLog"]> }) {
  return <div className="game-log">{entries.slice(-12).map((entry) => <p key={`${entry.at}-${entry.message}`}><span>{new Date(entry.at).toLocaleTimeString()}</span> {entry.message}</p>)}</div>;
}

function AudioPanel({ view, audio, botVoice }: { view: RoomView; audio: ReturnType<typeof useIntegratedAudio>; botVoice: ReturnType<typeof useBotVoice> }) {
  const you = view.you;
  const muted = view.players.find((player) => player.id === you?.id)?.muted ?? false;
  if (!you) return null;
  return (
    <div className="audio">
      <h2><Shield size={18} /> Audio</h2>
      <div className="bot-sound-panel">
        <div className="bot-sound-status">
          <strong>{botVoice.enabled ? "Son active" : "Son coupe"}</strong>
          {botVoice.speaking && <span>Bot en train de parler...</span>}
          {audio.botListening && <span>Bot ecoute</span>}
        </div>
        <div className="actions-row audio-actions">
          <button disabled={botVoice.enabled} onClick={botVoice.enable}><Volume2 size={17} /> Activer le son</button>
          <button disabled={!botVoice.enabled} onClick={botVoice.disable}><VolumeX size={17} /> Couper le son</button>
        </div>
        {botVoice.status === "error" && <small>Audio indisponible, reponse affichee en texte.</small>}
      </div>
      <p>{view.audioMode === "external" ? "Audio externe sélectionné. Utilisez WhatsApp, Discord ou un autre canal." : you.canHearAudio ? "Audio intégré actif selon les permissions serveur." : "Audio coupé pour cette phase."}</p>
      {view.audioMode === "integrated" && (
        <>
          <div className="actions-row audio-actions">
            <button disabled={!you.canHearAudio || audio.permission === "requesting"} onClick={audio.enabled ? audio.stopAudio : audio.startAudio}>
              {audio.enabled ? <MicOff size={17} /> : <Mic size={17} />} {audio.enabled ? "Couper le micro" : "Activer le micro"}
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
  return <section className="transition-banner">{isNight ? <Moon /> : <Sun />}<h2>{isNight ? "La nuit tombe…" : "Le jour se lève…"}</h2></section>;
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
  if (view.phase === "DEBATE") return "Débat";
  if (view.phase === "NOMINATION") return "Nominations";
  if (view.phase === "DEFENSE") {
    const speaker = view.players.find((player) => player.id === view.activePlayerId);
    return `Défense${speaker ? ` de ${speaker.name}` : ""}`;
  }
  if (view.phase === "VOTING") return "Vote";
  if (view.phase === "RESULT") return "Prochaine phase";
  return phaseLabel(view.phase);
}

function canHearRemote(view: RoomView, fromPlayerId: string) {
  if (view.audioMode !== "integrated" || !view.you?.canHearAudio || !view.you.audioPeerIds.includes(fromPlayerId)) return false;
  if (view.phase === "LOBBY") return true;
  if (view.phase === "NIGHT") return view.currentNightStep === "infiltres" && view.you.role === "Infiltre";
  if (view.phase === "DEFENSE") {
    const speaker = view.players.find((player) => player.id === fromPlayerId);
    return view.activePlayerId === fromPlayerId || (!!speaker && !speaker.alive && !speaker.isBot);
  }
  if (["MAYOR_NOMINATION", "MAYOR_ELECTION", "DAY_ANNOUNCEMENT", "DEBATE", "NOMINATION", "DEFENSE_REQUESTS", "VOTING", "RESULT"].includes(view.phase)) return true;
  return false;
}

function audioStatusText(audio: ReturnType<typeof useIntegratedAudio>, muted: boolean, canSpeak: boolean) {
  if (audio.permission === "requesting") return "Demande de permission micro…";
  if (audio.permission === "unsupported") return "Navigateur non compatible avec l'audio intégré.";
  if (audio.permission === "missing") return "Aucun micro détecté.";
  if (audio.permission === "denied") return "Micro refusé par le navigateur.";
  if (!audio.enabled) return "Le micro n'est pas connecté.";
  if (muted || !canSpeak) return "Micro connecté, parole coupée par les règles.";
  return `Micro actif. Pairs audio : ${audio.activePeers}.`;
}

function botVoiceRate(name: string) {
  if (name.includes("Myriam")) return 0.88;
  if (name.includes("Daniel")) return 0.96;
  if (name.includes("Sarah")) return 1.05;
  if (name.includes("Samuel")) return 0.9;
  return 0.94;
}

function botVoicePitch(name: string) {
  if (name.includes("Myriam")) return 0.92;
  if (name.includes("Daniel")) return 0.82;
  if (name.includes("Sarah")) return 1.16;
  if (name.includes("Naomi")) return 1.05;
  return 0.98;
}

function phaseLabel(phase: RoomView["phase"] | string) {
  const labels: Partial<Record<string, string>> = {
    LOBBY: "Lobby",
    ROLE_DISTRIBUTION: "Distribution",
    MAYOR_NOMINATION: "Nominations Maire",
    MAYOR_ELECTION: "Élection Maire",
    NIGHT: "Nuit",
    DAY_ANNOUNCEMENT: "Annonce jour",
    DEBATE: "Débat",
    NOMINATION: "Nominations",
    DEFENSE_REQUESTS: "Demandes défense",
    DEFENSE: "Défense",
    VOTING: "Vote",
    RESULT: "Résultat",
    GAME_OVER: "Fin"
  };
  return labels[phase] ?? `Phase ${phase}`;
}

function adminStatusLabel(status: AdminRoomSummary["status"]) {
  const labels: Record<AdminRoomSummary["status"], string> = {
    lobby: "lobby",
    inGame: "partie en cours",
    finished: "terminée"
  };
  return labels[status];
}

function participationLabel(value: BotRoomConfig["participation"]) {
  const labels: Record<BotRoomConfig["participation"], string> = {
    discreet: "discret",
    normal: "normal",
    talkative: "talkative"
  };
  return labels[value];
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function pickNarratorVoice(): SpeechSynthesisVoice | undefined {
  const voices = narratorVoices.length ? narratorVoices : window.speechSynthesis.getVoices();
  const french = voices.filter((voice) => /^fr/i.test(voice.lang));
  if (!french.length) return undefined;
  // On privilégie une voix française de qualité (neural/Google), grave de préférence,
  // adaptée à un conteur de jeu d'ambiance.
  const score = (voice: SpeechSynthesisVoice) => {
    const name = voice.name.toLowerCase();
    let value = 0;
    if (/fr-fr/i.test(voice.lang)) value += 4;
    if (/(natural|neural|enhanced|premium|wavenet)/.test(name)) value += 9;
    if (/google/.test(name)) value += 6;
    if (/(thomas|paul|henri|r[ée]mi|nicolas|claude|mathieu|guillaume)/.test(name)) value += 4;
    if (/(am[ée]lie|audrey|julie|hortense|denise|charlotte|l[ée]a|virginie)/.test(name)) value += 2;
    if (voice.localService === false) value += 2;
    return value;
  };
  return [...french].sort((a, b) => score(b) - score(a))[0];
}

function stopNarration() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  if (narrationAudio) {
    narrationAudio.pause();
    narrationAudio = null;
  }
}

async function speakNarration(text: string, phase: RoomView["phase"], transition?: RoomView["transition"]) {
  if (!text) return;
  stopNarration();
  // Voix studio Azure si le serveur l'a activée ; sinon repli sur la voix du navigateur.
  if (narratorTtsEnabled) {
    try {
      const response = await fetch("/api/narration/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, phase })
      });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size) {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          narrationAudio = audio;
          const cleanup = () => URL.revokeObjectURL(url);
          audio.onended = cleanup;
          audio.onerror = cleanup;
          await audio.play();
          return;
        }
      }
    } catch {
      // Repli silencieux sur la voix du navigateur.
    }
  }
  speakWithBrowser(text, phase, transition);
}

function speakWithBrowser(text: string, phase: RoomView["phase"], transition?: RoomView["transition"]) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickNarratorVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? "fr-FR";
  const night = phase === "NIGHT" || transition === "night-falls";
  const solemn = phase === "GAME_OVER";
  // Ton de conteur : grave et posé, plus encore la nuit ou en fin de partie.
  utterance.rate = night ? 0.8 : solemn ? 0.84 : 0.9;
  utterance.pitch = night ? 0.68 : solemn ? 0.72 : 0.8;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
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
