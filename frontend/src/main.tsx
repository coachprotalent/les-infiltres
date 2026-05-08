import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import { Clock, Copy, Crown, Gavel, Mic, MicOff, Moon, Play, Settings, Shield, Sun, Users, Vote } from "lucide-react";
import type { ClientToServerEvents, GameConfig, Role, RoomView, ServerToClientEvents } from "@les-infiltres/shared";
import { DEFAULT_CONFIG, ROLE_ABILITIES, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, mergeConfig } from "@les-infiltres/shared";
import "./styles.css";

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type RtcSignal = RTCSessionDescriptionInit | RTCIceCandidateInit;
type PeerEntry = {
  connection: RTCPeerConnection;
  audio?: HTMLAudioElement;
};

const socket: AppSocket = io("/", { autoConnect: true });
const sessionKey = "les-infiltres-session";
const roomKey = "les-infiltres-room";

function App() {
  const [view, setView] = useState<RoomView | null>(null);
  const [toast, setToast] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [audioMode, setAudioMode] = useState<"integrated" | "external">("external");
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG);

  useEffect(() => {
    socket.on("roomState", (next) => {
      persist(next);
      setView(next);
    });
    socket.on("toast", setToast);
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
          {toast && <p className="toast">{toast}</p>}
        </section>
      </main>
    );
  }

  return <Game view={view} toast={toast} onToast={setToast} />;
}

function Game({ view, toast, onToast }: { view: RoomView; toast: string; onToast: (message: string) => void }) {
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

  const secondsLeft = view.timerEndsAt ? Math.max(0, Math.ceil((view.timerEndsAt - now) / 1000)) : undefined;
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
        <StatusPill view={view} secondsLeft={secondsLeft} />
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
        {mayor && <p className="mayor-line"><Crown size={16} /> Maire : {mayor.name}</p>}
        {you && !you.alive && <p className="spectator-line">Vous etes spectateur : vous voyez les debats sans voter, parler ni agir.</p>}
        {toast && <p className="toast">{toast}</p>}
      </section>

      <div className="layout">
        <section className="panel main-panel">
          {view.phase === "LOBBY" && <Lobby view={view} />}
          {view.phase === "MAYOR_ELECTION" && <MayorElection view={view} />}
          {view.phase !== "LOBBY" && you && <RoleCard view={view} />}
          {view.phase === "NIGHT" && <NightPanel view={view} />}
          {["DAY_ANNOUNCEMENT", "DEBATE", "DEFENSE"].includes(view.phase) && <DebatePanel view={view} secondsLeft={secondsLeft} />}
          {view.phase === "VOTING" && <VotePanel view={view} />}
          {view.phase === "RESULT" && <ResultPanel view={view} />}
          {view.phase === "GAME_OVER" && <EndPanel view={view} />}
        </section>

        <aside className="panel side-panel">
          <AudioPanel view={view} audio={audio} />
          <h2><Users size={18} /> Joueurs</h2>
          <div className="players">
            {view.players.map((player) => (
              <div className={`player ${player.alive ? "" : "out"} ${player.speaking ? "speaking" : ""}`} key={player.id}>
                <span>{player.name}{player.isMayor ? " - Maire" : ""}{player.isHost ? " - Hote" : ""}</span>
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

      {you?.isMayor && you.alive && <MayorPanel view={view} alivePlayers={alivePlayers} />}
      {you?.isHost && <AdminPanel view={view} />}
    </main>
  );
}

function useIntegratedAudio(view: RoomView, onToast: (message: string) => void) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<"idle" | "requesting" | "granted" | "denied">("idle");
  const [peerCount, setPeerCount] = useState(0);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerEntry>());
  const viewRef = useRef(view);

  viewRef.current = view;

  const stopAudio = () => {
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
    setPermission("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setEnabled(true);
      setPermission("granted");
    } catch {
      setPermission("denied");
      onToast("Permission micro refusee.");
    }
  };

  useEffect(() => {
    if (view.audioMode !== "integrated" && enabled) stopAudio();
  }, [view.audioMode, enabled]);

  useEffect(() => {
    const canTransmit = view.audioMode === "integrated" && enabled && !!view.you?.canHearAudio && !!view.you.canSpeak && !currentPlayer(view)?.muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = canTransmit;
    });
    for (const [peerId, peer] of peersRef.current.entries()) {
      if (peer.audio) peer.audio.muted = !canHearRemote(view, peerId);
    }
  }, [view, enabled]);

  useEffect(() => {
    if (!enabled || view.audioMode !== "integrated" || !view.you || !localStreamRef.current) return;
    const peerIds = view.players.filter((player) => player.connected && player.id !== view.you?.id).map((player) => player.id);
    for (const peerId of peerIds) ensurePeer(peerId, view.you.id < peerId);
    for (const [peerId, peer] of peersRef.current.entries()) {
      if (!peerIds.includes(peerId)) {
        peer.audio?.remove();
        peer.connection.close();
        peersRef.current.delete(peerId);
        setPeerCount(peersRef.current.size);
      }
    }
  }, [view.players, view.audioMode, view.you?.id, enabled]);

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
  const canStart = view.lobby.playerCount >= view.lobby.minPlayers;

  useEffect(() => setDraft(view.config), [view.config]);

  const saveConfig = (next: GameConfig) => {
    setDraft(next);
    socket.emit("updateConfig", { code: view.code, config: next });
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
      {view.you?.isHost && <ConfigEditor config={draft} onChange={saveConfig} />}
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
        <label>Max joueurs<input type="number" min={7} max={20} value={config.maxPlayers} onChange={(e) => update({ maxPlayers: Number(e.target.value) })} /></label>
        <label>Egalite<select value={config.tieRule} onChange={(e) => update({ tieRule: e.target.value === "revote" ? "revote" : "none" })}><option value="none">Aucun elimine</option><option value="revote">Revote</option></select></label>
        <label>Nuit<input type="number" value={config.durations.night} onChange={(e) => update({ durations: { ...config.durations, night: Number(e.target.value) } })} /></label>
        <label>Debat<input type="number" value={config.durations.freeDebate} onChange={(e) => update({ durations: { ...config.durations, freeDebate: Number(e.target.value) } })} /></label>
        <label>Defense<input type="number" value={config.durations.defense} onChange={(e) => update({ durations: { ...config.durations, defense: Number(e.target.value) } })} /></label>
        <label>Vote<input type="number" value={config.durations.vote} onChange={(e) => update({ durations: { ...config.durations, vote: Number(e.target.value) } })} /></label>
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

function MayorElection({ view }: { view: RoomView }) {
  const [targetId, setTargetId] = useState("");
  const voted = view.mayorVotes.some((vote) => vote.voterId === view.you?.id);
  const canVote = !!view.you?.alive && !!view.you?.canVote;
  return (
    <div className="content">
      <h2>Election du Maire</h2>
      <p>Le Maire est une fonction publique, distincte des roles secrets. Il gere la parole et possede une voix double.</p>
      <p>{view.mayorVotes.length} vote(s) enregistres.</p>
      <SelectTarget value={targetId} onChange={setTargetId} players={view.players.filter((player) => player.alive)} />
      <button className="primary" disabled={!targetId || voted || !canVote} onClick={() => socket.emit("electMayor", { code: view.code, targetId })}>
        <Crown size={18} /> Voter pour le Maire
      </button>
      {voted && <p className="muted">Votre vote pour le Maire est enregistre.</p>}
    </div>
  );
}

function RoleCard({ view }: { view: RoomView }) {
  const role = view.you?.role;
  if (!role) return null;
  return (
    <div className="role-card">
      <span>Votre role secret</span>
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
          <button onClick={() => socket.emit("nightAction", { code: view.code })}>Ne rien faire</button>
        </div>
      </ActionBlock>
    );
  }

  if (isLeaderInterrupt) {
    return (
      <ActionBlock title="Leader de Louange">
        <p>Vous pouvez entonner un cantique pour interrompre la nuit. Tout le monde ouvrira les yeux et le jeu passera au jour.</p>
        <button className="primary" onClick={() => socket.emit("nightAction", { code: view.code })}>Entonner un cantique</button>
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
      <button className="primary" disabled={!targetId} onClick={() => socket.emit("nightAction", { code: view.code, targetId })}>Valider</button>
    </ActionBlock>
  );
}

function PowerNotice({ view }: { view: RoomView }) {
  const used = view.you?.powerStatuses.filter((power) => power.used) ?? [];
  if (!used.length) return null;
  return <p className="used-power">Pouvoir deja utilise : {used.map((power) => power.label).join(", ")}</p>;
}

function DebatePanel({ view, secondsLeft }: { view: RoomView; secondsLeft?: number }) {
  const speaker = view.players.find((player) => player.id === view.activePlayerId);
  return (
    <div className="content">
      <h2>{view.phase === "DAY_ANNOUNCEMENT" ? "Le jour se leve" : view.phase === "DEFENSE" ? "Defense individuelle" : "Debat en cours"}</h2>
      <p>Joueur qui parle : <strong>{speaker?.name ?? "discussion libre"}</strong></p>
      <p>Temps restant : <strong>{secondsLeft !== undefined ? formatSeconds(secondsLeft) : "non chronometre"}</strong></p>
      {!view.you?.isMayor && <p className="muted">Le Maire controle la parole et le passage au vote.</p>}
    </div>
  );
}

function VotePanel({ view }: { view: RoomView }) {
  const [targetId, setTargetId] = useState("");
  const canVote = !!view.you?.alive && !!view.you?.canVote;
  return (
    <div className="content">
      <h2>Vote</h2>
      <p>{view.votes.length} vote(s) enregistres. Le Maire a une voix double. Le Sage pese aussi double au depouillement.</p>
      <SelectTarget value={targetId} onChange={setTargetId} players={view.players.filter((player) => player.alive && player.id !== view.you?.id)} />
      <button className="primary" disabled={!targetId || !canVote} onClick={() => socket.emit("vote", { code: view.code, targetId })}><Vote size={18} /> Voter</button>
      {!canVote && <p className="muted">Vous ne pouvez pas voter a cette phase.</p>}
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

function EndPanel({ view }: { view: RoomView }) {
  return (
    <div className="content">
      <h2>Fin de partie</h2>
      <p>Victoire : <strong>{view.winner}</strong></p>
      <p>{view.narrator}</p>
      {view.gameLog && <GameLog entries={view.gameLog} />}
    </div>
  );
}

function MayorPanel({ view, alivePlayers }: { view: RoomView; alivePlayers: RoomView["players"] }) {
  const [speechPlayer, setSpeechPlayer] = useState(alivePlayers[0]?.id ?? "");
  const speaker = view.players.find((player) => player.id === view.activePlayerId);
  return (
    <section className="hostbar mayorbar">
      <strong><Crown size={17} /> Panneau Maire</strong>
      <select value={speechPlayer} onChange={(event) => setSpeechPlayer(event.target.value)}>{alivePlayers.map((player) => <option value={player.id} key={player.id}>{player.name}</option>)}</select>
      <button onClick={() => socket.emit("startDebate", { code: view.code })}>Debat global</button>
      <button disabled={!speechPlayer} onClick={() => socket.emit("grantSpeech", { code: view.code, playerId: speechPlayer })}>Defense</button>
      <button onClick={() => socket.emit("stopSpeech", { code: view.code })}>Couper</button>
      <button onClick={() => socket.emit("startVote", { code: view.code })}>Passer au vote</button>
      <span>{speaker ? `Parle : ${speaker.name}` : "Parole libre"}</span>
    </section>
  );
}

function AdminPanel({ view }: { view: RoomView }) {
  return (
    <section className="adminbar">
      <strong>Admin hote</strong>
      <button onClick={() => socket.emit("adminNext", { code: view.code })}>Debloquer la phase</button>
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
      <p>{view.audioMode === "external" ? "Audio du jeu desactive. Utilisez WhatsApp, Discord ou un autre canal." : you.canHearAudio ? "Audio integre actif selon les permissions serveur." : "Audio coupe pour les spectateurs elimines."}</p>
      {view.audioMode === "integrated" && (
        <>
          <div className="actions-row audio-actions">
            <button disabled={!you.canHearAudio || audio.permission === "requesting"} onClick={audio.enabled ? audio.stopAudio : audio.startAudio}>
              {audio.enabled ? <MicOff size={17} /> : <Mic size={17} />} {audio.enabled ? "Couper audio" : "Activer micro"}
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

function StatusPill({ view, secondsLeft }: { view: RoomView; secondsLeft?: number }) {
  return (
    <div className="status">
      <span>{phaseLabel(view.phase)}</span>
      <span>Tour {view.round}</span>
      {secondsLeft !== undefined && <span><Clock size={15} /> {formatSeconds(secondsLeft)}</span>}
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

function canHearRemote(view: RoomView, fromPlayerId: string) {
  if (view.audioMode !== "integrated" || !view.you?.canHearAudio) return false;
  if (view.phase === "NIGHT") return view.currentNightStep === "infiltres" && view.you.role === "Infiltre";
  if (view.phase === "DEFENSE") return view.activePlayerId === fromPlayerId;
  if (view.phase === "DAY_ANNOUNCEMENT" || view.phase === "DEBATE") return true;
  return false;
}

function audioStatusText(audio: ReturnType<typeof useIntegratedAudio>, muted: boolean, canSpeak: boolean) {
  if (audio.permission === "requesting") return "Demande de permission micro...";
  if (audio.permission === "denied") return "Micro refuse par le navigateur.";
  if (!audio.enabled) return "Le micro n'est pas connecte.";
  if (muted || !canSpeak) return "Micro connecte, parole coupee par les regles.";
  return `Micro ouvert. Pairs audio : ${audio.activePeers}.`;
}

function phaseLabel(phase: RoomView["phase"]) {
  const labels: Record<RoomView["phase"], string> = {
    LOBBY: "Lobby",
    ROLE_DISTRIBUTION: "Distribution",
    MAYOR_ELECTION: "Election Maire",
    NIGHT: "Nuit",
    DAY_ANNOUNCEMENT: "Annonce jour",
    DEBATE: "Debat",
    DEFENSE: "Defense",
    VOTING: "Vote",
    RESULT: "Resultat",
    GAME_OVER: "Fin"
  };
  return labels[phase];
}

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

createRoot(document.getElementById("root")!).render(<App />);
