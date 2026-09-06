import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import vm from "node:vm";
import {validateVoiceSelection, readVoicePreferences, voiceSettings, runtimeWithVoice} from "../lib/local-voices.mjs";
import {createTtsAudioId, splitTtsPlaybackText, synthesizeDocReaderSpeechChunk} from "../lib/tts-cache.mjs";

const catalog = {schema: "clawdad.local-voices/1", models: [
  {id: "pocket", modelId: "pocket-tts-3.1", name: "Pocket", installed: true, enabled: true, supportsSpeed: false, voices: [{id: "alba"}, {id: "anna"}]},
  {id: "kitten", modelId: "kitten-tts-mini-0.8", name: "Kitten", installed: true, enabled: true, supportsSpeed: true, voices: [{id: "Bella"}, {id: "Jasper"}]},
]};

test("model-specific voices and controls reject mismatched voices, URLs and unsupported speed", () => {
  assert.throws(() => validateVoiceSelection({engine: "pocket", voice: "Bella"}, catalog));
  assert.throws(() => validateVoiceSelection({engine: "pocket", voice: "file:///private/voice.wav"}, catalog));
  assert.throws(() => validateVoiceSelection({engine: "pocket", voice: "alba", speed: 1.2}, catalog));
  assert.throws(() => validateVoiceSelection({engine: "kitten", voice: "Bella", speed: "NaN"}, catalog));
  assert.equal(validateVoiceSelection({engine: "kitten", voice: "Jasper", speed: 1.2}, catalog).speed, 1.2);
});

test("saved voice is canonical across clients, survives reload and retains each model's choice", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clawdad-voices-"));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const options = {configPath: path.join(dir, "server.json")};
  const runtime = {engine: "kokoro", modelId: "kokoro", voiceId: "af_heart", baseUrl: "http://remote.invalid", fallbackUrl: `http://localhost/voices-${Date.now()}`, requestTimeoutMs: 45000};
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json(catalog);
  t.after(() => { globalThis.fetch = original; });
  await Promise.all([
    voiceSettings(options, runtime, {engine: "pocket", voice: "anna", speed: 1}),
    voiceSettings(options, runtime, {engine: "kitten", voice: "Jasper", speed: 1.15}),
  ]);
  const saved = await readVoicePreferences(options, runtime);
  assert.ok(["anna", "Jasper"].includes(saved.selection.voice));
  assert.equal(saved.voicesByModel.pocket.voice, "anna");
  assert.equal(saved.voicesByModel.kitten.voice, "Jasper");
  // Concurrent clients can arrive in either order; both model choices survive.
  await voiceSettings(options, runtime, {engine: "kitten", voice: "Jasper", speed: 1.15});
  const next = await runtimeWithVoice(options, runtime);
  assert.equal(next.voiceId, "Jasper");
  assert.equal(next.speed, 1.15);
  assert.equal(next.baseUrl, runtime.fallbackUrl);
  assert.equal(next.fallbackUrl, "");
  const preview = await runtimeWithVoice(options, runtime, {engine: "pocket", voice: "alba", speed: 1});
  assert.equal(preview.voiceId, "alba");
  assert.equal((await readVoicePreferences(options, runtime)).selection.voice, "Jasper");
});

test("audio cache separates speed and the first sentence is ready independently", async () => {
  const input = {text: "The original response", modelId: "kitten-tts-mini-0.8", voiceId: "Bella"};
  assert.notEqual(createTtsAudioId({...input,speed: 1}), createTtsAudioId({...input,speed: 1.2}));
  const first = "You can keep listening while you switch projects.";
  const rest = "This is the rest of the response. ".repeat(30).trim();
  const chunks = splitTtsPlaybackText(first + " " + rest);
  assert.equal(chunks[0], first);
  assert.equal(chunks.join(" "), first + " " + rest);
  let received;
  await synthesizeDocReaderSpeechChunk({baseUrl: "http://localhost",fallbackUrl:"",engine:"kitten",voiceId:"Jasper",speed:1.3,text:"Hello",fetchImpl: async (_url, options) => {received=JSON.parse(options.body);return new Response("audio");}});
  assert.equal(received.speed,1.3);
  assert.equal(received.voice,"Jasper");
});

test("desktop reading uses the latest saved voice and Stop cancels a pending settings refresh", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const functionSource = source.slice(source.indexOf("async function playMessageAudio("), source.indexOf("function handleMessageAudioPlaybackError("));
  for (const stopped of [false, true]) {
    let finishRefresh;
    const refresh = new Promise((resolve, reject) => { finishRefresh = stopped ? reject : resolve; });
    const playback = {stopped: false};
    let prepared = null;
    const context = vm.createContext({
      activeMessageAudio: playback,
      audioPlaybackStatus: () => "idle",
      reserveMessageAudioPlayback: () => playback,
      fetchJson: () => refresh,
      audioAvailability: () => ({}),
      audioPartsFromAvailability: () => [],
      prepareAndPlayMessageAudio: (_key, payload) => { prepared = payload; return true; },
    });
    vm.runInContext(functionSource, context);
    const pending = context.playMessageAudio("response", {text: "Read the selected response."});
    if (stopped) {
      playback.stopped = true;
      context.activeMessageAudio = null;
      finishRefresh(new Error("Computer disconnected"));
      assert.equal(await pending, false);
      assert.equal(prepared, null);
    } else {
      finishRefresh({selection: {engine: "pocket", modelId: "pocket-tts-3.1", voice: "anna", speed: 1}});
      assert.equal(await pending, true);
      assert.equal(prepared.voiceSelection.voice, "anna");
    }
  }
});

test("background desktop refresh preserves voice menu options while model changes update them", async () => {
  const source = await readFile(new URL("../web/app.js", import.meta.url), "utf8");
  const functionSource = source.slice(source.indexOf("function speechFilteredVoices("), source.indexOf("function bindSpeechSettings("));
  const controls = new Map();
  const control = id => {
    if (!controls.has(id)) controls.set(id, {dataset: {}, value: "", children: [], replaceChildren(...items) { this.children = items; }});
    return controls.get(id);
  };
  const models = catalog.models.map(m => ({...m, voices: m.voices.map(v => ({...v, name: v.id, language: "English", gender: "unspecified"}))}));
  const state = {speechSettings: {models}, speechDraft: {engine: "pocket", voice: "anna", speed: 1}, speechLanguage: "All", speechGender: "All"};
  const context = vm.createContext({state, document: {querySelector: control, createElement: () => ({})}});
  vm.runInContext(functionSource, context);
  context.renderSpeechSettings();
  const modelOptions = control("#speechModel").children;
  const voiceOptions = control("#speechVoice").children;
  context.renderSpeechSettings();
  assert.equal(control("#speechModel").children, modelOptions);
  assert.equal(control("#speechVoice").children, voiceOptions);
  state.speechDraft = {engine: "kitten", voice: "Jasper", speed: 1.15};
  context.renderSpeechSettings();
  assert.equal(control("#speechModel").children, modelOptions);
  assert.notEqual(control("#speechVoice").children, voiceOptions);
  assert.equal(control("#speechVoice").value, "Jasper");
});
