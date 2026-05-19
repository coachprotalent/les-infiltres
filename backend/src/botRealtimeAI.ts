import type { BotRoomConfig, ChatMessage, GamePhase, NightStep, Role, VoteTotal, VoteViewRecord } from "@les-infiltres/shared";
import { DEFAULT_BOT_CONFIG, ROLE_LABELS, mergeBotConfig } from "@les-infiltres/shared";
import WebSocket from "ws";

export type BotAllowedAction = "speak" | "nominateMayor" | "voteMayor" | "nominate" | "requestDefense" | "vote" | "nightAction" | "pass";

export type BotDecision =
  | { action: "speak"; message: string }
  | { action: "nominateMayor"; targetPlayerId: string }
  | { action: "voteMayor"; targetPlayerId: string; reason?: string }
  | { action: "nominate"; targetPlayerId: string }
  | { action: "requestDefense"; message?: string }
  | { action: "vote"; targetPlayerId: string; reason?: string }
  | { action: "nightAction"; targetPlayerId?: string; roleChoice?: Role; ministerAction?: "save" | "jail" }
  | { action: "pass"; reason?: string };

export type BotAIContext = {
  botName: string;
  botPersonality: string;
  botRoleplayProfile?: {
    role: string;
    temperament: string;
    suspicionLevel: number;
    humorLevel: number;
    defensiveAggression: number;
    accusationBias: number;
    calmingBias: number;
  };
  speakingStyle: string;
  botRole?: Role;
  phase: GamePhase;
  currentNightStep?: NightStep;
  publicEvents: string[];
  visibleMessages: ChatMessage[];
  lastMessagesAddressedToBot: ChatMessage[];
  alivePlayers: Array<{ id: string; name: string; isSelf: boolean; isMayor: boolean }>;
  nominatedPlayers: Array<{ id: string; name: string }>;
  currentVoteState: {
    votes: VoteViewRecord[];
    totals: VoteTotal[];
  };
  knownSuspicions: Array<{ playerId: string; playerName: string; suspicion: number }>;
  memory: string[];
  privateRoleInfo: string[];
  currentStrategy: string;
  allowedActions: BotAllowedAction[];
};

type RealtimeMessage = {
  type?: string;
  response?: {
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
    };
    output?: Array<{
      content?: Array<{
        text?: string;
        transcript?: string;
      }>;
    }>;
  };
  delta?: string;
  text?: string;
  error?: {
    message?: string;
  };
  item?: {
    content?: Array<{
      text?: string;
      transcript?: string;
    }>;
  };
};

export class BotRealtimeAIService {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly reasoningEnabled: boolean;
  readonly reasoningConfigured: boolean;
  readonly autoSpeakEnabled: boolean;
  readonly voiceVariationEnabled: boolean;
  readonly defaultVoice: string;
  readonly availableVoices: string[];
  readonly speakCooldownSeconds: number;
  readonly maxMessagesPerMinute: number;
  readonly maxPerRoom: number;
  readonly audioEnabled: boolean;
  readonly defaults: BotRoomConfig;
  private readonly realtimeEndpoint: string;
  private readonly realtimeApiKey: string;
  private readonly realtimeApiVersion: string;
  private readonly realtimeDeployment: string;
  private readonly reasoningEndpoint: string;
  private readonly reasoningApiKey: string;
  private readonly reasoningApiVersion: string;
  private readonly reasoningDeployment: string;
  private readonly transcriptionEndpoint: string;
  private readonly transcriptionApiKey: string;
  private readonly transcriptionApiVersion: string;
  private readonly transcriptionDeployment: string;
  private readonly maxReasoningTokens: number;
  private readonly responseStyle: string;
  private readonly personalityVariation: boolean;
  private readonly participation: string;
  private readonly timeoutMs: number;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.realtimeEndpoint = (env.AZURE_OPENAI_REALTIME_ENDPOINT ?? env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/+$/, "");
    this.realtimeApiKey = env.AZURE_OPENAI_REALTIME_API_KEY ?? env.AZURE_OPENAI_API_KEY ?? "";
    this.realtimeApiVersion = env.AZURE_OPENAI_REALTIME_API_VERSION ?? env.AZURE_OPENAI_API_VERSION ?? "2024-10-01-preview";
    this.realtimeDeployment = env.AZURE_OPENAI_REALTIME_DEPLOYMENT || "gpt-realtime-1.5";
    this.reasoningEndpoint = (env.AZURE_OPENAI_REASONING_ENDPOINT ?? "").replace(/\/+$/, "");
    this.reasoningApiKey = env.AZURE_OPENAI_REASONING_API_KEY ?? "";
    this.reasoningApiVersion = env.AZURE_OPENAI_REASONING_API_VERSION || "2025-01-01-preview";
    this.reasoningDeployment = env.AZURE_OPENAI_REASONING_DEPLOYMENT || "gpt5.4";
    this.transcriptionEndpoint = (env.AZURE_OPENAI_TRANSCRIPTION_ENDPOINT ?? "").replace(/\/+$/, "");
    this.transcriptionApiKey = env.AZURE_OPENAI_TRANSCRIPTION_API_KEY ?? "";
    this.transcriptionApiVersion = env.AZURE_OPENAI_TRANSCRIPTION_API_VERSION || "2025-01-01-preview";
    this.transcriptionDeployment = env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT || "";
    this.enabled = (env.BOT_AI_ENABLED ?? "false").toLowerCase() === "true";
    this.configured = !!this.realtimeEndpoint && !!this.realtimeApiKey;
    this.reasoningEnabled = (env.BOT_REASONING_ENABLED ?? "true").toLowerCase() === "true";
    this.reasoningConfigured = !!this.reasoningEndpoint && !!this.reasoningApiKey;
    this.maxPerRoom = clampInt(Number(env.BOT_MAX_PER_ROOM ?? 20), 0, 20, 20);
    this.participation = env.BOT_DEFAULT_PARTICIPATION || "normal";
    this.audioEnabled = (env.BOT_AUDIO_ENABLED ?? "false").toLowerCase() === "true";
    this.maxReasoningTokens = clampInt(Number(env.BOT_MAX_REASONING_TOKENS ?? 1200), 120, 4000, 1200);
    this.responseStyle = env.BOT_RESPONSE_STYLE || "advanced";
    this.personalityVariation = (env.BOT_PERSONALITY_VARIATION ?? "true").toLowerCase() === "true";
    this.autoSpeakEnabled = (env.BOT_AUTO_SPEAK_ENABLED ?? "true").toLowerCase() === "true";
    this.voiceVariationEnabled = (env.BOT_VOICE_VARIATION_ENABLED ?? "true").toLowerCase() === "true";
    this.defaultVoice = env.BOT_DEFAULT_VOICE || "alloy";
    this.availableVoices = (env.BOT_AVAILABLE_VOICES || "alloy,ash,ballad,coral,echo,onyx,nova,sage,shimmer,verse")
      .split(",")
      .map((voice) => voice.trim())
      .filter(Boolean);
    this.speakCooldownSeconds = clampInt(Number(env.BOT_SPEAK_COOLDOWN_SECONDS ?? 20), 5, 300, 20);
    this.maxMessagesPerMinute = clampInt(Number(env.BOT_MAX_MESSAGES_PER_MINUTE ?? 2), 1, 10, 2);
    this.timeoutMs = clampInt(Number(env.BOT_AI_TIMEOUT_MS ?? 12000), 3000, 60000, 12000);
    this.defaults = mergeBotConfig({
      enabled: this.enabled,
      count: clampInt(Number(env.BOT_DEFAULT_COUNT ?? 1), 0, this.maxPerRoom, DEFAULT_BOT_CONFIG.count),
      autoFill: (env.BOT_AUTO_FILL_ENABLED ?? "false").toLowerCase() === "true",
      participation: botParticipation(this.participation),
      audioEnabled: this.audioEnabled,
      averageResponseMs: clampInt(Number(env.BOT_AVERAGE_RESPONSE_MS ?? 1500), 250, 10000, 1500),
      allowMayor: (env.BOT_ALLOW_MAYOR ?? "true").toLowerCase() === "true",
      allowDebateSpeech: (env.BOT_ALLOW_DEBATE_SPEECH ?? "true").toLowerCase() === "true",
      allowAudio: (env.BOT_ALLOW_AUDIO ?? "false").toLowerCase() === "true"
    });
    this.logStartup();
  }

  async decide(context: BotAIContext, participation = this.participation): Promise<BotDecision | undefined> {
    if (!this.enabled || (!this.reasoningConfigured && !this.configured)) return undefined;
    const layer = this.reasoningEnabled && this.reasoningConfigured ? "reasoning" : "realtime";
    const deployment = layer === "reasoning" ? this.reasoningDeployment : this.realtimeDeployment;
    console.log(`[BotAI] Bot ${context.botName} phase=${context.phase} called ${layer} deployment=${deployment}`);
    try {
      const content = layer === "reasoning"
        ? await this.requestReasoningDecision(context, participation)
        : await this.requestRealtimeDecision(context, participation);
      if (!content) return undefined;
      return parseDecision(content);
    } catch (error) {
      console.error("[BotAI] Azure error:", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private async requestReasoningDecision(context: BotAIContext, participation: string): Promise<string | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const endpoint = new URL(this.reasoningEndpoint);
      endpoint.pathname = `/openai/deployments/${encodeURIComponent(this.reasoningDeployment)}/chat/completions`;
      endpoint.searchParams.set("api-version", this.reasoningApiVersion);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "api-key": this.reasoningApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: this.systemPrompt() },
            { role: "user", content: JSON.stringify({ ...context, responseStyle: this.responseStyle, personalityVariation: this.personalityVariation }) }
          ],
          temperature: this.temperature(participation),
          max_tokens: this.maxReasoningTokens
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Reasoning HTTP ${response.status}: ${await response.text()}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestRealtimeDecision(context: BotAIContext, participation: string): Promise<string | undefined> {
    const urls = this.realtimeUrls();
    let lastError: unknown;
    for (const url of urls) {
      try {
        return await this.requestRealtimeUrl(url, context, participation);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
    return undefined;
  }

  private requestRealtimeUrl(url: string, context: BotAIContext, participation: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers: { "api-key": this.realtimeApiKey } });
      const chunks: string[] = [];
      let settled = false;
      const timeout = setTimeout(() => finish(undefined, new Error(`Realtime timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
      const finish = (value?: string, error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.close();
        } catch {
          // ignore close errors after a settled realtime request
        }
        if (error) reject(error);
        else resolve(value);
      };

      ws.on("open", () => {
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text"],
            instructions: this.systemPrompt(),
            temperature: this.temperature(participation)
          }
        }));
        ws.send(JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: JSON.stringify(context) }]
          }
        }));
        ws.send(JSON.stringify({
          type: "response.create",
          response: {
            modalities: ["text"],
            instructions: "Retourne uniquement l'objet JSON d'action, sans Markdown ni texte autour.",
            max_output_tokens: 240
          }
        }));
      });

      ws.on("message", (raw) => {
        const message = parseRealtimeMessage(raw.toString());
        if (!message) return;
        if (message.type === "error") return finish(undefined, new Error(message.error?.message ?? "Realtime error"));
        if (message.type?.startsWith("response.") && message.delta) chunks.push(message.delta);
        if (message.type?.startsWith("response.") && message.text) chunks.push(message.text);
        if (message.response?.status === "failed") return finish(undefined, new Error(message.response.status_details?.error?.message ?? "Realtime response failed"));
        if (message.type === "response.done") return finish(responseText(message) || chunks.join("").trim());
      });

      ws.on("error", (error) => finish(undefined, error instanceof Error ? error : new Error(String(error))));
      ws.on("close", () => {
        if (!settled && chunks.length) finish(chunks.join("").trim());
        else if (!settled) finish(undefined, new Error("Realtime socket closed before response"));
      });
    });
  }

  private realtimeUrls() {
    const endpoint = new URL(this.realtimeEndpoint);
    endpoint.protocol = endpoint.protocol === "http:" ? "ws:" : "wss:";
    const preview = new URL(endpoint.toString());
    preview.pathname = "/openai/realtime";
    preview.searchParams.set("api-version", this.realtimeApiVersion);
    preview.searchParams.set("deployment", this.realtimeDeployment);
    const ga = new URL(endpoint.toString());
    ga.pathname = "/openai/v1/realtime";
    ga.searchParams.set("model", this.realtimeDeployment);
    return this.realtimeApiVersion.includes("preview") ? [preview.toString(), ga.toString()] : [ga.toString(), preview.toString()];
  }

  private temperature(participation: string) {
    if (participation === "discreet") return 0.35;
    if (participation === "talkative") return 0.75;
    return 0.55;
  }

  private systemPrompt() {
    return [
      "Tu joues a Les Infiltres comme un joueur humain.",
      "Tu controles un bot dans un jeu social de discussion. Le bot doit parler comme une vraie personne, avec une personnalite distincte.",
      "Analyse le contexte: qui parle, ce qui vient d'etre dit, la personnalite du bot, et s'il doit repondre, se defendre, accuser, calmer le jeu ou se taire.",
      "Ne reponds pas toujours. Si le bot parle, donne une reponse naturelle, adaptee a son caractere, avec un raisonnement implicite sans reveler qu'il est une IA.",
      "Respecte strictement la personnalite, le style et la memoire du bot fournis dans le contexte.",
      "Tu ne connais que le contexte JSON fourni. N'invente jamais de roles caches ou d'actions invisibles.",
      "Lis les messages visibles, surtout lastMessagesAddressedToBot si un joueur t'appelle.",
      "Ne repete pas exactement une phrase recente d'un autre bot ou de toi-meme.",
      "Retourne uniquement un objet JSON avec une action autorisee.",
      "Utilise les ids exacts des joueurs pour les cibles.",
      "Quand l'action est speak, le message peut etre plus developpe et personnel, mais reste jouable en conversation orale."
    ].join(" ");
  }

  private logStartup() {
    console.log(`[BotAI] enabled=${this.enabled} realtimeConfigured=${this.configured} reasoningConfigured=${this.reasoningConfigured} audio=${this.audioEnabled} realtimeDeployment=${this.realtimeDeployment} reasoningDeployment=${this.reasoningDeployment}`);
    console.log(`[BotAI] realtimeEndpoint=${this.realtimeEndpoint ? "present" : "absent"} realtimeApiKey=${this.realtimeApiKey ? "present" : "absent"} realtimeApiVersion=${this.realtimeApiVersion}`);
    console.log(`[BotAI] reasoningEndpoint=${this.reasoningEndpoint ? "present" : "absent"} reasoningApiKey=${this.reasoningApiKey ? "present" : "absent"} reasoningApiVersion=${this.reasoningApiVersion}`);
    console.log(`[BotAI] transcriptionEndpoint=${this.transcriptionEndpoint ? "present" : "absent"} transcriptionApiKey=${this.transcriptionApiKey ? "present" : "absent"} transcriptionDeployment=${this.transcriptionDeployment || "absent"} transcriptionApiVersion=${this.transcriptionApiVersion}`);
    console.log(`[BotAI] voices variation=${this.voiceVariationEnabled} default=${this.defaultVoice} available=${this.availableVoices.join(",")}`);
  }
}

function parseRealtimeMessage(raw: string): RealtimeMessage | undefined {
  try {
    return JSON.parse(raw) as RealtimeMessage;
  } catch {
    return undefined;
  }
}

function responseText(message: RealtimeMessage) {
  const values: string[] = [];
  for (const output of message.response?.output ?? []) {
    if (output.content) values.push(...output.content.flatMap((item) => item.text ?? item.transcript ?? []));
  }
  return values.join("").trim();
}

function parseDecision(content: string): BotDecision | undefined {
  try {
    const parsed = JSON.parse(content) as Partial<BotDecision>;
    if (!parsed || typeof parsed.action !== "string") return undefined;
    if (parsed.action === "speak" && typeof parsed.message === "string") return { action: "speak", message: parsed.message.slice(0, 480) };
    if (parsed.action === "nominateMayor" && typeof parsed.targetPlayerId === "string") return { action: "nominateMayor", targetPlayerId: parsed.targetPlayerId };
    if (parsed.action === "voteMayor" && typeof parsed.targetPlayerId === "string") return { action: "voteMayor", targetPlayerId: parsed.targetPlayerId, reason: stringOrUndefined(parsed.reason) };
    if (parsed.action === "nominate" && typeof parsed.targetPlayerId === "string") return { action: "nominate", targetPlayerId: parsed.targetPlayerId };
    if (parsed.action === "requestDefense") return { action: "requestDefense", message: stringOrUndefined(parsed.message) };
    if (parsed.action === "vote" && typeof parsed.targetPlayerId === "string") return { action: "vote", targetPlayerId: parsed.targetPlayerId, reason: stringOrUndefined(parsed.reason) };
    if (parsed.action === "nightAction") {
      return {
        action: "nightAction",
        targetPlayerId: stringOrUndefined(parsed.targetPlayerId),
        roleChoice: isRole(parsed.roleChoice) ? parsed.roleChoice : undefined,
        ministerAction: parsed.ministerAction === "save" || parsed.ministerAction === "jail" ? parsed.ministerAction : undefined
      };
    }
    if (parsed.action === "pass") return { action: "pass", reason: stringOrUndefined(parsed.reason) };
  } catch {
    return undefined;
  }
  return undefined;
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE_LABELS;
}

function stringOrUndefined(value: unknown) {
  return typeof value === "string" ? value.slice(0, 480) : undefined;
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function botParticipation(value: string) {
  return value === "discreet" || value === "talkative" ? value : "normal";
}
