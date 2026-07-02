export type Voice = {
  id: string
  name: string
  gender: "male" | "female"
  provider: "azure" | "f5"
  voiceRef?: string
}

export const VOICES: Voice[] = [
  { id: "mn-MN-BataaNeural", name: "Батаа", gender: "male", provider: "azure" },
  { id: "mn-MN-YesuiNeural", name: "Есүй", gender: "female", provider: "azure" },
  { id: "f5-mn-male", name: "Киночид", gender: "male", provider: "f5", voiceRef: "male" },
]

export const DEFAULT_VOICE_ID = VOICES[0]!.id
