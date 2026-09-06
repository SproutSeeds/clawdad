import path from "node:path";
import crypto from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";

const catalogs = new Map();
const settingsWrites = new Map();
const settingsPath = (options) => path.join(path.dirname(options.configPath), "voice-settings.json");

export function localVoiceServiceUrl(runtime) {
  return runtime.fallbackUrl || runtime.baseUrl;
}

export async function localVoiceCatalog(runtime, fetchImpl = globalThis.fetch) {
  const base = localVoiceServiceUrl(runtime).replace(/\/+$/u, "");
  const cached = catalogs.get(base);
  if (cached && Date.now() - cached.time < 30_000) return cached.value;
  const response = await fetchImpl(`${base}/v1/voices`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Update the local speech service to choose models and voices.");
  const value = await response.json();
  if (value.schema !== "clawdad.local-voices/1" || !Array.isArray(value.models)) {
    throw new Error("The local speech service returned an invalid voice catalog.");
  }
  catalogs.set(base, {time: Date.now(), value});
  return value;
}

export function validateVoiceSelection(selection, catalog) {
  const model = catalog.models.find((entry) => entry.id === selection?.engine);
  if (!model) throw new Error("Choose an available speech model.");
  if (!model.installed || !model.enabled) throw new Error(`${model.name} needs installation on this computer.`);
  const voice = model.voices.find((entry) => entry.id === selection.voice);
  if (!voice) throw new Error("Choose a voice from the selected model.");
  const speed = Number(selection.speed ?? 1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2 || (!model.supportsSpeed && speed !== 1)) {
    throw new Error("Choose a speaking speed supported by this model.");
  }
  return { engine: model.id, modelId: model.modelId, voice: voice.id, speed };
}

export async function readVoicePreferences(options, runtime) {
  let saved = {};
  try { saved = JSON.parse(await readFile(settingsPath(options), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return {
    selection: saved.selection || {engine: runtime.engine, modelId: runtime.modelId, voice: runtime.voiceId, speed: runtime.speed || 1},
    voicesByModel: saved.voicesByModel || {},
  };
}

export async function voiceSettings(options, runtime, selection = null) {
  const catalog = await localVoiceCatalog(runtime);
  let preferences = await readVoicePreferences(options, runtime);
  if (selection) {
    const validated = validateVoiceSelection(selection, catalog);
    const target = settingsPath(options);
    const write = (settingsWrites.get(target) || Promise.resolve()).catch(() => {}).then(async () => {
      const current = await readVoicePreferences(options, runtime);
      const next = {selection: validated, voicesByModel: {...current.voicesByModel, [validated.engine]: validated}};
      await mkdir(path.dirname(target), {recursive: true});
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next, null, 2) + "\n", {mode: 0o600});
      await rename(temporary, target);
      return next;
    });
    settingsWrites.set(target, write);
    try { preferences = await write; }
    finally { if (settingsWrites.get(target) === write) settingsWrites.delete(target); }
  }
  return {...catalog, ...preferences};
}

export async function runtimeWithVoice(options, runtime, override = null) {
  const preferences = await readVoicePreferences(options, runtime);
  // Existing hosts retain their configured voice until the first explicit save.
  const saved = Object.values(preferences.voicesByModel).length > 0;
  if (!saved && !override) return runtime;
  const selection = validateVoiceSelection(override || preferences.selection, await localVoiceCatalog(runtime));
  return {...runtime, provider: "doc-reader", engine: selection.engine, modelId: selection.modelId,
    voiceId: selection.voice, speed: selection.speed,
    baseUrl: localVoiceServiceUrl(runtime), fallbackUrl: "", preferDirectAudio: true,
    requestTimeoutMs: Math.max(runtime.requestTimeoutMs, 180_000), chunkChars: 600,
  };
}
