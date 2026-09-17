import type { VoiceSettings } from '../../../shared/types'

const SAMPLE_RATE = 16000
const SILENCE_MS = 1400
const SPEECH_RMS = 0.0008
const MAX_MS = 60_000
const PARTIAL_MS = 1600
const PARTIAL_MAX_SEC = 6
const ASR_MAX_SEC = 8
const TTS_ID = 'onnx-community/Supertonic-TTS-ONNX'
const TTS_STEPS = 5

type AsrPipeline = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text?: string }>
type TtsResult = { audio?: Float32Array; data?: Float32Array; sampling_rate: number }
type TtsPipeline = (
  text: string,
  options: { speaker_embeddings: string; num_inference_steps?: number; speed?: number }
) => Promise<TtsResult>

export type TtsVoice = { voiceURI: string; name: string }

export const TTS_VOICES: TtsVoice[] = [
  { voiceURI: 'M1', name: 'Male 1' },
  { voiceURI: 'F1', name: 'Female 1' },
  { voiceURI: 'M2', name: 'Male 2' },
  { voiceURI: 'F2', name: 'Female 2' },
  { voiceURI: 'M3', name: 'Male 3' },
  { voiceURI: 'F3', name: 'Female 3' },
  { voiceURI: 'M4', name: 'Male 4' },
  { voiceURI: 'F4', name: 'Female 4' },
  { voiceURI: 'M5', name: 'Male 5' },
  { voiceURI: 'F5', name: 'Female 5' }
]

let asr: AsrPipeline | null = null
let asrLoading: Promise<AsrPipeline> | null = null
let tts: TtsPipeline | null = null
let ttsLoading: Promise<TtsPipeline> | null = null
let transformersReady: Promise<typeof import('@huggingface/transformers')> | null = null
let speakGen = 0
let ttsContext: AudioContext | null = null
let ttsGain: GainNode | null = null
const liveSources = new Set<AudioBufferSourceNode>()

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const t = x - i0
    output[i] = input[i0] * (1 - t) + input[i1] * t
  }
  return output
}

async function transformersEnv(): Promise<typeof import('@huggingface/transformers')> {
  if (transformersReady) return transformersReady
  transformersReady = (async () => {
    const [tf, { ortMjs, ortWasm }] = await Promise.all([
      import('@huggingface/transformers'),
      import('./ortAssets')
    ])
    tf.env.allowRemoteModels = false
    tf.env.allowLocalModels = true
    tf.env.useBrowserCache = false
    tf.env.localModelPath = 'grokcode-model://models/'
    const onnxWasm = tf.env.backends.onnx.wasm as { wasmPaths?: { mjs: string; wasm: string } } | undefined
    if (onnxWasm) {
      onnxWasm.wasmPaths = { mjs: ortMjs, wasm: ortWasm }
    }
    return tf
  })()
  return transformersReady
}

let onnxChain: Promise<unknown> = Promise.resolve()

function withOnnx<T>(fn: () => Promise<T>): Promise<T> {
  const run = onnxChain.then(fn, fn)
  onnxChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function loadAsr(): Promise<void> {
  await withOnnx(async () => {
    await getAsr()
  })
}

export async function loadTts(): Promise<void> {
  await withOnnx(async () => {
    await getTts()
  })
}

async function getAsr(): Promise<AsrPipeline> {
  if (asr) return asr
  if (asrLoading) return asrLoading
  asrLoading = (async () => {
    const { pipeline } = await transformersEnv()
    const pipe = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      device: 'wasm',
      dtype: { model: 'fp32', decoder_model_merged: 'q4' }
    })
    asr = ((audio, options) => pipe(audio, options)) as AsrPipeline
    return asr
  })()
  try {
    return await asrLoading
  } catch (error) {
    asrLoading = null
    throw error
  }
}

async function getTts(): Promise<TtsPipeline> {
  if (tts) return tts
  if (ttsLoading) return ttsLoading
  ttsLoading = (async () => {
    const ready = await window.grokcode.ensureVoiceModel()
    if (!ready.ready) throw new Error(ready.error || 'Speech model is not ready')
    const { pipeline } = await transformersEnv()
    const pipe = await pipeline('text-to-speech', TTS_ID, { device: 'wasm' })
    tts = ((text, options) => pipe(text, options)) as TtsPipeline
    return tts
  })()
  try {
    return await ttsLoading
  } catch (error) {
    ttsLoading = null
    throw error
  }
}

function expandSpokenContractions(text: string): string {
  return text
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/\b(I|you|we|they|he|she|who)'ll\b/gi, (_full, pronoun: string) => {
      const spoken = pronoun.toLowerCase() === 'i' ? 'I' : pronoun
      return `${spoken} will`
    })
}

export function speakableText(markdown: string): string {
  let text = markdown.replace(/```[\s\S]*?```/g, ' ')
  text = text.replace(/`[^`]+`/g, ' ')
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/[*_~>]+/g, '')
  text = text.replace(/\n{2,}/g, '. ')
  text = text.replace(/\s+/g, ' ').trim()
  text = expandSpokenContractions(text)
  if (text.length > 2500) text = `${text.slice(0, 2500).trim()}…`
  return text
}

function voiceId(settings: VoiceSettings): string {
  return TTS_VOICES.some((item) => item.voiceURI === settings.voiceURI) ? settings.voiceURI : 'M1'
}

function speakerUrl(id: string): string {
  return `grokcode-model://models/${TTS_ID}/voices/${id}.bin`
}

const STREAM_CLAUSE = 220

function splitSpeakChunks(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g) ?? [text]
  const chunks: string[] = []
  let buf = ''
  for (const part of parts) {
    const next = `${buf}${part}`
    if (next.length > 280 && buf.trim()) {
      chunks.push(buf.trim())
      buf = part
    } else {
      buf = next
    }
  }
  if (buf.trim()) chunks.push(buf.trim())
  return chunks
}

export function takeSpeakableDelta(
  full: string,
  consumed: string,
  flush: boolean
): { speak: string; consumed: string } {
  if (!full) return { speak: '', consumed: flush ? full : consumed }
  let prefix = consumed
  if (!full.startsWith(consumed)) {
    if (!flush) return { speak: '', consumed }
    let i = 0
    const n = Math.min(consumed.length, full.length)
    while (i < n && consumed[i] === full[i]) i++
    prefix = full.slice(0, i)
  }
  const rest = full.slice(prefix.length)
  if (!rest) return { speak: '', consumed: prefix }
  if (flush) return { speak: rest.trim(), consumed: full }
  const complete = rest.match(/[^.!?]+[.!?]+(?:["')\]]+)?/g)
  let used = complete ? complete.join('') : ''
  const leftover = rest.slice(used.length)
  if (leftover.trim().length >= STREAM_CLAUSE) used += leftover
  return { speak: used.trim(), consumed: prefix + used }
}

function stopPlayback(): void {
  if (ttsGain) ttsGain.gain.value = 0
  for (const source of liveSources) {
    try {
      source.stop()
    } catch {
      // already stopped
    }
    try {
      source.disconnect()
    } catch {
      // already disconnected
    }
  }
  liveSources.clear()
}

function ensureTtsOutput(sampleRate: number): { context: AudioContext; gain: GainNode } {
  if (!ttsContext) {
    ttsContext = new AudioContext({ sampleRate })
    ttsGain = ttsContext.createGain()
    ttsGain.connect(ttsContext.destination)
  }
  ttsGain ??= ttsContext.createGain()
  return { context: ttsContext, gain: ttsGain }
}

export function primeTtsOutput(): void {
  const { context, gain } = ensureTtsOutput(22050)
  gain.gain.value = 1
  if (context.state === 'suspended') void context.resume()
}

function dropSource(source: AudioBufferSourceNode): void {
  liveSources.delete(source)
  try {
    source.stop()
  } catch {
    // already stopped
  }
  try {
    source.disconnect()
  } catch {
    // already disconnected
  }
}

async function playPcm(samples: Float32Array, sampleRate: number, gen: number): Promise<void> {
  if (gen !== speakGen) return
  const { context, gain } = ensureTtsOutput(sampleRate)
  if (context.state === 'suspended') await context.resume()
  if (gen !== speakGen) return
  const buffer = context.createBuffer(1, samples.length, sampleRate)
  buffer.getChannelData(0).set(samples)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(gain)
  liveSources.add(source)
  if (gen !== speakGen) {
    dropSource(source)
    return
  }
  gain.gain.value = 1
  await new Promise<void>((resolve) => {
    source.onended = () => {
      liveSources.delete(source)
      resolve()
    }
    if (gen !== speakGen) {
      dropSource(source)
      resolve()
      return
    }
    source.start()
  })
}

type SpeakJob = { text: string; settings: VoiceSettings }

let speakQueue: SpeakJob[] = []
let drainPromise: Promise<void> | null = null

export function stopSpeaking(): void {
  speakGen += 1
  speakQueue = []
  stopPlayback()
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export function isSpeaking(): boolean {
  return liveSources.size > 0 || speakQueue.length > 0 || drainPromise !== null
}

export function listVoices(): TtsVoice[] {
  return TTS_VOICES
}

function drainQueue(): Promise<void> {
  if (drainPromise) return drainPromise
  if (speakQueue.length === 0) return Promise.resolve()
  const gen = speakGen
  drainPromise = (async () => {
    try {
      while (speakQueue.length) {
        if (gen !== speakGen) return
        const job = speakQueue.shift()
        if (!job) break
        try {
          const speed = Math.min(2, Math.max(0.7, job.settings.rate))
          const embeddings = speakerUrl(voiceId(job.settings))
          const result = tts
            ? await tts(job.text, {
                speaker_embeddings: embeddings,
                num_inference_steps: TTS_STEPS,
                speed
              })
            : await withOnnx(async () => {
                const pipe = await getTts()
                return pipe(job.text, {
                  speaker_embeddings: embeddings,
                  num_inference_steps: TTS_STEPS,
                  speed
                })
              })
          if (gen !== speakGen) return
          const samples = result.data ?? result.audio
          if (!samples || samples.length === 0) continue
          await playPcm(samples, result.sampling_rate, gen)
          playedKeys.add(normKey(job.text))
        } catch (error) {
          speakQueue.unshift(job)
          throw error
        }
      }
    } catch (error) {
      throw error
    } finally {
      drainPromise = null
      if (speakQueue.length > 0) await drainQueue()
    }
  })()
  return drainPromise
}

const playedKeys = new Set<string>()

function normKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function resetSpokenLog(): void {
  playedKeys.clear()
}

export async function speakText(
  text: string,
  settings: VoiceSettings,
  opts?: { append?: boolean }
): Promise<void> {
  const spoken = speakableText(text)
  if (!opts?.append) {
    speakGen += 1
    speakQueue = []
    stopPlayback()
  }
  if (spoken) {
    for (const chunk of splitSpeakChunks(spoken)) {
      const key = normKey(chunk)
      if (!key || playedKeys.has(key)) continue
      if (speakQueue.some((job) => normKey(job.text) === key)) continue
      speakQueue.push({ text: chunk, settings })
    }
  }
  if (speakQueue.length === 0 && !opts?.append) return
  const gen = speakGen
  try {
    await drainQueue()
  } catch (error) {
    if (gen !== speakGen) return
    const rest = speakQueue.map((job) => job.text).join(' ')
    speakQueue = []
    if (!rest.trim()) return
    await speakBrowser(rest, settings, gen)
  }
}

async function browserVoices(): Promise<SpeechSynthesisVoice[]> {
  const have = speechSynthesis.getVoices()
  if (have.length > 0) return have
  await new Promise<void>((resolve) => {
    const done = (): void => {
      speechSynthesis.onvoiceschanged = null
      resolve()
    }
    speechSynthesis.onvoiceschanged = done
    setTimeout(done, 400)
  })
  return speechSynthesis.getVoices()
}

async function speakBrowser(text: string, settings: VoiceSettings, gen: number): Promise<void> {
  if (typeof speechSynthesis === 'undefined') {
    throw new Error('No speech engine available')
  }
  const voices = await browserVoices()
  if (gen !== speakGen) return
  await new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = Math.min(2, Math.max(0.7, settings.rate))
    const female = settings.voiceURI.startsWith('F')
    const match = voices.find((voice) =>
      female
        ? /female|samantha|karen|moira|zira|fiona|siri/i.test(voice.name)
        : /male|daniel|alex|david|fred|tom/i.test(voice.name)
    )
    if (match) utter.voice = match
    utter.onend = () => resolve()
    utter.onerror = () => resolve()
    speechSynthesis.cancel()
    speechSynthesis.speak(utter)
  })
}

const JUNK_WORDS = new Set([
  'you',
  'uh',
  'um',
  'huh',
  'hmm',
  'ah',
  'oh',
  'yeah',
  'yes',
  'the',
  'a',
  'i',
  'and',
  'thank',
  'thanks'
])

export function isJunkTranscript(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return true
  if (words.length <= 2 && words.every((word) => JUNK_WORDS.has(word))) return true
  return false
}

function cleanTranscript(text: string, heardSpeech: boolean): string {
  const trimmed = text.trim()
  if (!trimmed || isJunkTranscript(trimmed)) return ''
  if (!heardSpeech && trimmed.split(/\s+/).length < 3) return ''
  return trimmed
}

export async function transcribePcm(
  samples: Float32Array,
  sampleRate: number,
  heardSpeech = true
): Promise<string> {
  const audio = resample(samples, sampleRate, SAMPLE_RATE)
  const max = SAMPLE_RATE * ASR_MAX_SEC
  const clipped = audio.length > max ? audio.subarray(audio.length - max) : audio
  return withOnnx(async () => {
    const pipe = await getAsr()
    const result = await pipe(clipped)
    return cleanTranscript(result.text ?? '', heardSpeech)
  })
}

export type PcmClip = { samples: Float32Array; sampleRate: number; heardSpeech: boolean }

export type Recorder = {
  stop: () => Promise<PcmClip>
}

export const WAVE_BARS = 7

export type VoiceMotion = { bands: number[]; level: number }

const quietBands = (): number[] => Array.from({ length: WAVE_BARS }, () => 0)

let voiceMotion: VoiceMotion = { bands: quietBands(), level: 0 }

export function getVoiceMotion(): VoiceMotion {
  return voiceMotion
}

export function resetVoiceMotion(): void {
  voiceMotion = { bands: quietBands(), level: 0 }
}

export type MicInput = { deviceId: string; label: string }

export async function listMicInputs(): Promise<MicInput[]> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
    probe.getTracks().forEach((track) => track.stop())
  } catch {
    // device labels stay hidden until permission is granted
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  const seen = new Set<string>()
  const mics: MicInput[] = []
  for (const item of devices) {
    if (item.kind !== 'audioinput' || !item.deviceId || seen.has(item.deviceId)) continue
    seen.add(item.deviceId)
    mics.push({
      deviceId: item.deviceId,
      label: item.label.trim() || `Microphone ${mics.length + 1}`
    })
  }
  return mics
}

function isUnusableMic(label: string, deviceId: string): boolean {
  const name = label.toLowerCase()
  if (deviceId === 'default' || deviceId === 'communications') return true
  if (name.startsWith('default -') || name.startsWith('communications -')) return true
  if (name.includes('virtual') || name.includes('teams audio')) return true
  if (name.includes('iphone') || name.includes('ipad')) return true
  return false
}

async function openMicStream(deviceId?: string): Promise<MediaStream> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
  if (deviceId) audio.deviceId = { exact: deviceId }
  try {
    return await navigator.mediaDevices.getUserMedia({ audio })
  } catch (error) {
    if (!deviceId) throw error
    return navigator.mediaDevices.getUserMedia({ audio: true })
  }
}

type MicAudioData = {
  sampleRate: number
  allocationSize: (opts: { planeIndex: number; format: string }) => number
  copyTo: (dest: Float32Array, opts: { planeIndex: number; format: string }) => void
  close: () => void
}

type TrackProcessor = {
  readable: ReadableStream<MicAudioData>
}

function trackProcessor(track: MediaStreamTrack): TrackProcessor | null {
  const Ctor = (
    globalThis as unknown as {
      MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => TrackProcessor
    }
  ).MediaStreamTrackProcessor
  if (!Ctor) return null
  return new Ctor({ track })
}

async function readPcmFrame(
  reader: ReadableStreamDefaultReader<MicAudioData>
): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const { value, done } = await reader.read()
  if (done || !value) return null
  try {
    const bytes = value.allocationSize({ planeIndex: 0, format: 'f32-planar' })
    const samples = new Float32Array(bytes / 4)
    value.copyTo(samples, { planeIndex: 0, format: 'f32-planar' })
    return { samples, sampleRate: value.sampleRate }
  } finally {
    value.close()
  }
}

async function streamSignalScore(stream: MediaStream, ms: number): Promise<number> {
  const track = stream.getAudioTracks()[0]
  if (!track || track.readyState !== 'live') return 0
  const processor = trackProcessor(track)
  if (!processor) return 1
  const reader = processor.readable.getReader()
  const deadline = performance.now() + ms
  let nz = 0
  try {
    while (performance.now() < deadline) {
      const frame = await readPcmFrame(reader)
      if (!frame) break
      for (let i = 0; i < frame.samples.length; i++) {
        if (Math.abs(frame.samples[i] ?? 0) > 1e-5) nz++
      }
      if (nz > 80) return nz
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      /* already cancelled */
    }
  }
  return nz
}

export async function openLiveMicStream(preferredId?: string): Promise<MediaStream> {
  const mics = await listMicInputs()
  const ordered: string[] = []
  if (preferredId) ordered.push(preferredId)
  for (const mic of mics) {
    if (!isUnusableMic(mic.label, mic.deviceId) && !ordered.includes(mic.deviceId)) {
      ordered.push(mic.deviceId)
    }
  }
  let fallback: MediaStream | null = null
  for (const id of ordered) {
    let stream: MediaStream
    try {
      stream = await openMicStream(id)
    } catch {
      continue
    }
    const score = await streamSignalScore(stream, 220)
    if (score > 80) return stream
    if (!fallback) fallback = stream
    else stream.getTracks().forEach((track) => track.stop())
  }
  if (fallback) return fallback
  return openMicStream()
}

export type NativeSpeech = { stop: () => void }

type RecInstance = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: {
    resultIndex: number
    results: ArrayLike<{ isFinal: boolean; 0?: { transcript?: string } }>
  }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

export function startNativeSpeech(handlers: {
  onCaption: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}): NativeSpeech {
  const Ctor = (window as unknown as { SpeechRecognition?: new () => RecInstance }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => RecInstance }).webkitSpeechRecognition
  if (!Ctor) throw new Error('Native speech recognition is not available in this window')
  const rec = new Ctor()
  rec.continuous = true
  rec.interimResults = true
  rec.lang = 'en-US'
  rec.onresult = (event) => {
    let interim = ''
    let finals = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i]?.[0]?.transcript ?? ''
      if (event.results[i]?.isFinal) finals += piece
      else interim += piece
    }
    if (interim.trim()) handlers.onCaption(interim.trim())
    if (finals.trim()) {
      handlers.onCaption('')
      handlers.onFinal(finals.trim())
    }
  }
  rec.onerror = (event) => {
    if (event.error === 'no-speech' || event.error === 'aborted') return
    handlers.onError(event.error)
  }
  rec.onend = () => handlers.onEnd()
  rec.start()
  return {
    stop: () => {
      rec.onend = null
      rec.onresult = null
      rec.onerror = null
      try {
        rec.stop()
      } catch {
        /* already stopped */
      }
    }
  }
}

export async function startRecorder(handlers: {
  context?: AudioContext
  deviceId?: string
  stream?: MediaStream
  idleStop?: boolean
  onLevel: (rms: number, silentFor: number, heardSpeech: boolean) => void
  onBands?: (bands: number[]) => void
  onPartial?: (clip: PcmClip) => void
  onAutoStop: (clip: PcmClip) => void
}): Promise<Recorder> {
  const stream = handlers.stream ?? (await openLiveMicStream(handlers.deviceId))
  for (const track of stream.getAudioTracks()) track.enabled = true
  const track = stream.getAudioTracks()[0]
  if (!track) throw new Error('No microphone track')
  const chunks: Float32Array[] = []
  let sampleRate = track.getSettings().sampleRate ?? SAMPLE_RATE
  let heard = false
  let silentMs = 0
  let last = performance.now()
  const started = last
  let stopping = false
  let lastPartialAt = started
  let captured = 0

  function snapshot(): Float32Array {
    const max = Math.floor(sampleRate * PARTIAL_MAX_SEC)
    let total = captured
    let skip = Math.max(0, total - max)
    const out = new Float32Array(Math.min(total, max))
    let offset = 0
    for (const chunk of chunks) {
      if (skip >= chunk.length) {
        skip -= chunk.length
        continue
      }
      const start = skip
      skip = 0
      out.set(chunk.subarray(start), offset)
      offset += chunk.length - start
    }
    return out
  }

  function onPcm(input: Float32Array, rate: number): void {
    if (stopping || input.length === 0) return
    sampleRate = rate
    chunks.push(new Float32Array(input))
    captured += input.length
    let sum = 0
    let peak = 0
    for (let i = 0; i < input.length; i++) {
      const sample = input[i] ?? 0
      sum += sample * sample
      const amp = Math.abs(sample)
      if (amp > peak) peak = amp
    }
    const rms = Math.sqrt(sum / input.length)
    const now = performance.now()
    const dt = now - last
    last = now
    if (rms >= SPEECH_RMS || peak >= SPEECH_RMS) {
      heard = true
      silentMs = 0
    } else if (heard) {
      silentMs += dt
    }
    handlers.onLevel(rms, silentMs, heard)
    const voice = Math.min(1, Math.max(peak * 80, rms * 120))
    const bands = new Array<number>(WAVE_BARS)
    const size = Math.max(1, Math.floor(input.length / WAVE_BARS))
    for (let i = 0; i < WAVE_BARS; i++) {
      let band = 0
      const start = i * size
      const end = i === WAVE_BARS - 1 ? input.length : start + size
      for (let j = start; j < end; j++) band += (input[j] ?? 0) * (input[j] ?? 0)
      bands[i] = Math.min(1, Math.sqrt(band / Math.max(1, end - start)) * 120 + voice * 0.35)
    }
    handlers.onBands?.(bands)
    voiceMotion = { bands, level: voice }
    if (heard && handlers.onPartial && now - lastPartialAt >= PARTIAL_MS && captured >= sampleRate * 0.7) {
      lastPartialAt = now
      handlers.onPartial({ samples: snapshot(), sampleRate, heardSpeech: true })
    }
    if (handlers.idleStop === false) return
    if (now - started > MAX_MS || (heard && silentMs >= SILENCE_MS)) {
      void stop().then(handlers.onAutoStop)
    }
  }

  const processor = trackProcessor(track)
  if (!processor) throw new Error('This Chromium build cannot read microphone PCM')
  const reader = processor.readable.getReader()
  const pump = (async () => {
    try {
      while (!stopping) {
        const frame = await readPcmFrame(reader)
        if (!frame) break
        onPcm(frame.samples, frame.sampleRate)
      }
    } catch {
      /* reader cancelled */
    }
  })()

  let finished: Promise<PcmClip> | null = null

  async function stop(): Promise<PcmClip> {
    if (finished) return finished
    stopping = true
    resetVoiceMotion()
    finished = (async () => {
      try {
        await reader.cancel()
      } catch {
        /* already cancelled */
      }
      await pump
      stream.getTracks().forEach((item) => item.stop())
      const length = chunks.reduce((n, chunk) => n + chunk.length, 0)
      const samples = new Float32Array(length)
      let offset = 0
      for (const chunk of chunks) {
        samples.set(chunk, offset)
        offset += chunk.length
      }
      return { samples, sampleRate, heardSpeech: heard }
    })()
    return finished
  }

  return { stop }
}
