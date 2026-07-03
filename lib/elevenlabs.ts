import { getElevenLabsApiKey, getElevenLabsVoiceId } from "./config";

export interface SpeechResult {
  audio: Buffer;
  mimeType: string;
}

/** Text-to-speech via ElevenLabs (returns MPEG audio). */
export async function synthesizeSpeech(text: string): Promise<SpeechResult | null> {
  const apiKey = getElevenLabsApiKey();
  const voiceId = getElevenLabsVoiceId();
  if (!apiKey || !text.trim()) return null;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        model_id: "eleven_turbo_v2_5",
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    console.error("[elevenlabs] TTS failed:", res.status, err.slice(0, 200));
    return null;
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audio: Buffer.from(arrayBuffer),
    mimeType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(getElevenLabsApiKey());
}
