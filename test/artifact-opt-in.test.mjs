import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("delegate prompts only include artifact handoff for explicit file requests", async () => {
  const source = await readFile(path.join(repoRoot, "lib", "server.mjs"), "utf8");
  const codexAppServerSource = await readFile(
    path.join(repoRoot, "lib", "codex-app-server-dispatch.mjs"),
    "utf8",
  );
  const dispatchShellSource = await readFile(path.join(repoRoot, "lib", "dispatch.sh"), "utf8");
  assert.match(source, /function textRequestsArtifactHandoff\(\.\.\.values\)/u);
  assert.match(source, /function artifactHandoffPrompt\(project\)/u);
  assert.match(source, /If the user explicitly requested a downloadable\/shareable file/u);
  assert.match(source, /function markDumpyHandoffRequested\(projectPath/u);
  assert.match(source, /function syncProjectArtifactsToDumpy\(projectPath/u);

  const promptStart = source.indexOf("function buildDelegateStepPrompt");
  const breakoutStart = source.indexOf("function buildDelegateStrategyBreakoutPrompt", promptStart);
  assert.notEqual(promptStart, -1);
  assert.notEqual(breakoutStart, -1);

  const promptBody = source.slice(promptStart, breakoutStart);
  assert.match(promptBody, /textRequestsArtifactHandoff\(brief\)/u);
  assert.doesNotMatch(promptBody, /textRequestsArtifactHandoff\(brief, status\?\.nextAction\)/u);
  assert.match(source, /markDumpyHandoffRequested\(projectPath\)/u);
  assert.match(source, /markDumpyHandoffRequested\(resolvedProjectPath\)/u);
  assert.match(source, /agentMessage: artifactHandoffRequested/u);
  assert.match(codexAppServerSource, /item\.payload\.agentMessage \|\| item\.payload\.message/u);
  assert.match(dispatchShellSource, /_artifact_augmented_message/u);
  assert.match(source, /Clawdad will send requested files from that folder to the project's Dumpy party/u);
  assert.doesNotMatch(promptBody, /If you create a deliverable file the user may need to download or share/u);
});

test("Codex dispatch converts image attachments from the manifest into localImage inputs", async () => {
  const source = await readFile(path.join(repoRoot, "lib", "codex-app-server-dispatch.mjs"), "utf8");
  assert.match(source, /attachmentManifest: ""/u);
  assert.match(source, /case "--attachment-manifest":/u);
  assert.match(source, /async function readAttachmentInputs\(manifestPath\)/u);
  assert.match(source, /type: "localImage"/u);
  assert.match(source, /function buildUserInput\(message, attachmentInputs = \[\]\)/u);
  assert.match(source, /\.\.\.\(Array\.isArray\(attachmentInputs\) \? attachmentInputs : \[\]\)/u);
  assert.match(source, /input: buildUserInput\(options\.message, options\.attachmentInputs\)/u);
});
