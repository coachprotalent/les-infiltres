// Synthèse vocale du narrateur côté serveur (optionnelle).
// Désactivée par défaut : si aucun fournisseur n'est configuré, le service reste
// inactif et le client retombe sur la voix du navigateur (Web Speech).
//
// Deux fournisseurs possibles via NARRATOR_TTS_PROVIDER :
//   - "azure-speech"  : Azure Cognitive Services Speech (voix neuronales + SSML).
//                       Idéal pour un narrateur (ex. fr-FR-HenriNeural).
//   - "azure-openai"  : Azure OpenAI /audio/speech (réutilise l'endpoint/clé OpenAI).

export type NarratorTtsClientConfig = {
  enabled: boolean;
};

export type NarratorAudio = {
  audio: Buffer;
  contentType: string;
};

type Provider = "azure-speech" | "azure-openai";

type Prosody = { rate: string; pitch: string; speed: number };

export class NarratorTtsService {
  readonly enabled: boolean;
  private readonly provider: Provider;
  private readonly voice: string;
  private readonly style: string;
  private readonly timeoutMs: number;

  // azure-speech
  private readonly speechKey: string;
  private readonly speechRegion: string;

  // azure-openai
  private readonly openaiEndpoint: string;
  private readonly openaiApiKey: string;
  private readonly openaiDeployment: string;
  private readonly openaiApiVersion: string;

  private readonly cache = new Map<string, NarratorAudio>();
  private readonly cacheMax = 200;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const requested = (env.NARRATOR_TTS_PROVIDER || "azure-speech").toLowerCase();
    this.provider = requested === "azure-openai" ? "azure-openai" : "azure-speech";
    this.style = env.NARRATOR_TTS_STYLE || "";
    this.timeoutMs = clampInt(Number(env.NARRATOR_TTS_TIMEOUT_MS ?? 8000), 2000, 30000, 8000);

    this.speechKey = env.AZURE_SPEECH_KEY ?? "";
    this.speechRegion = env.AZURE_SPEECH_REGION ?? "";

    this.openaiEndpoint = (env.AZURE_OPENAI_TTS_ENDPOINT ?? env.AZURE_OPENAI_ENDPOINT ?? env.AZURE_OPENAI_REALTIME_ENDPOINT ?? "").replace(/\/+$/, "");
    this.openaiApiKey = env.AZURE_OPENAI_TTS_API_KEY ?? env.AZURE_OPENAI_API_KEY ?? env.AZURE_OPENAI_REALTIME_API_KEY ?? "";
    this.openaiDeployment = env.AZURE_OPENAI_TTS_DEPLOYMENT ?? "";
    this.openaiApiVersion = env.AZURE_OPENAI_TTS_API_VERSION || "2024-08-01-preview";

    this.voice = env.NARRATOR_TTS_VOICE || (this.provider === "azure-openai" ? "onyx" : "fr-FR-HenriNeural");

    const flag = (env.NARRATOR_TTS_ENABLED ?? "false").toLowerCase() === "true";
    const configured = this.provider === "azure-speech"
      ? !!this.speechKey && !!this.speechRegion
      : !!this.openaiEndpoint && !!this.openaiApiKey && !!this.openaiDeployment;
    this.enabled = flag && configured;
    this.logStartup(flag, configured);
  }

  clientConfig(): NarratorTtsClientConfig {
    return { enabled: this.enabled };
  }

  async synthesize(text: string, phase: string): Promise<NarratorAudio | undefined> {
    if (!this.enabled || typeof text !== "string") return undefined;
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 600);
    if (!clean) return undefined;
    const key = `${this.provider}:${this.voice}:${phase}:${clean}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const prosody = prosodyFor(phase);
    try {
      const result = this.provider === "azure-speech"
        ? await this.synthesizeAzureSpeech(clean, prosody)
        : await this.synthesizeAzureOpenAI(clean, prosody);
      if (result) this.remember(key, result);
      return result;
    } catch (error) {
      console.error("[NarratorTTS] erreur de synthèse :", error instanceof Error ? error.message : error);
      return undefined;
    }
  }

  private remember(key: string, value: NarratorAudio) {
    this.cache.set(key, value);
    if (this.cache.size > this.cacheMax) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }

  private async synthesizeAzureSpeech(text: string, prosody: Prosody): Promise<NarratorAudio | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const endpoint = `https://${this.speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`;
      const inner = `<prosody rate="${prosody.rate}" pitch="${prosody.pitch}">${escapeXml(text)}</prosody>`;
      const body = this.style ? `<mstts:express-as style="${escapeXml(this.style)}">${inner}</mstts:express-as>` : inner;
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="fr-FR"><voice name="${escapeXml(this.voice)}">${body}</voice></speak>`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.speechKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "les-infiltres-narrator"
        },
        body: ssml,
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Azure Speech HTTP ${response.status}: ${await safeText(response)}`);
      const audio = Buffer.from(await response.arrayBuffer());
      return audio.length ? { audio, contentType: "audio/mpeg" } : undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async synthesizeAzureOpenAI(text: string, prosody: Prosody): Promise<NarratorAudio | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(this.openaiEndpoint);
      url.pathname = `/openai/deployments/${encodeURIComponent(this.openaiDeployment)}/audio/speech`;
      url.searchParams.set("api-version", this.openaiApiVersion);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": this.openaiApiKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.openaiDeployment,
          input: text,
          voice: this.voice,
          response_format: "mp3",
          speed: prosody.speed
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Azure OpenAI TTS HTTP ${response.status}: ${await safeText(response)}`);
      const audio = Buffer.from(await response.arrayBuffer());
      return audio.length ? { audio, contentType: "audio/mpeg" } : undefined;
    } finally {
      clearTimeout(timeout);
    }
  }

  private logStartup(flag: boolean, configured: boolean) {
    console.log(`[NarratorTTS] enabled=${this.enabled} provider=${this.provider} voice=${this.voice} flag=${flag} configured=${configured}`);
  }
}

function prosodyFor(phase: string): Prosody {
  // Ton de conteur : grave et posé, plus encore la nuit ou en fin de partie.
  if (phase === "NIGHT") return { rate: "-14%", pitch: "-6%", speed: 0.82 };
  if (phase === "GAME_OVER") return { rate: "-10%", pitch: "-4%", speed: 0.85 };
  return { rate: "-6%", pitch: "-2%", speed: 0.92 };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function safeText(response: Response) {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "";
  }
}

function clampInt(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
