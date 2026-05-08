export type NarrationEvent = {
  type: string;
  phase?: string;
  round?: number;
  summary?: string;
};

type AzureOpenAIConfig = {
  endpoint?: string;
  apiKey?: string;
  deployment?: string;
  apiVersion?: string;
};

const FALLBACKS: Record<string, string[]> = {
  nightStart: [
    "La nuit tombe sur le groupe. Les voix s'eteignent, mais les soupcons restent.",
    "Un silence pesant envahit la piece. Dans l'ombre, les secrets s'agitent."
  ],
  dayStart: [
    "Le jour se leve, et chacun cherche les signes de trahison.",
    "La lumiere revient. Les regards evitent ceux qui en savent trop."
  ],
  nomination: [
    "Les nominations sont ouvertes. Les noms prononces deviennent des poids difficiles a retirer.",
    "La salle retient son souffle pendant que les suspects sont designes."
  ],
  vote: [
    "Le vote commence. Chaque main levee rapproche quelqu'un de l'emprisonnement.",
    "Les voix se comptent maintenant a decouvert."
  ]
};

export class NarrationService {
  private readonly config: AzureOpenAIConfig;

  constructor(config: AzureOpenAIConfig = {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION
  }) {
    this.config = config;
  }

  static fallback(event: NarrationEvent, fallback: string) {
    const variants = FALLBACKS[event.type];
    if (!variants?.length) return fallback;
    const seed = `${event.type}:${event.phase ?? ""}:${event.round ?? 0}:${event.summary ?? ""}`;
    const index = Math.abs(hash(seed)) % variants.length;
    return variants[index];
  }

  isConfigured() {
    return !!this.config.endpoint && !!this.config.apiKey && !!this.config.deployment && !!this.config.apiVersion;
  }

  async generate(event: NarrationEvent, fallback: string) {
    if (!this.isConfigured()) return NarrationService.fallback(event, fallback);
    try {
      const endpoint = this.config.endpoint!.replace(/\/$/, "");
      const url = `${endpoint}/openai/deployments/${this.config.deployment}/chat/completions?api-version=${this.config.apiVersion}`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.config.apiKey!
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: "Tu es le narrateur d'un jeu social. Ecris une phrase courte, immersive, en francais. Ne decide jamais des actions, votes, roles, victimes ou gagnants."
            },
            {
              role: "user",
              content: JSON.stringify({
                type: event.type,
                phase: event.phase,
                round: event.round,
                summary: event.summary
              })
            }
          ],
          max_tokens: 60,
          temperature: 0.8
        })
      });
      if (!response.ok) return NarrationService.fallback(event, fallback);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content?.trim().slice(0, 220) || NarrationService.fallback(event, fallback);
    } catch {
      return NarrationService.fallback(event, fallback);
    }
  }
}

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = ((result << 5) - result + value.charCodeAt(index)) | 0;
  }
  return result;
}
