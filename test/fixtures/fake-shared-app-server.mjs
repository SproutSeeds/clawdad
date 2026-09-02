#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import process from "node:process";
import { WebSocketServer } from "ws";

const socketPath = String(process.argv[2] || "").trim();
const eventLogPath = String(process.argv[3] || "").trim();
const scenario = String(process.argv[4] || "idle");
const active = scenario === "active";
const disconnectOnce = scenario === "disconnect-once";
const foreignApproval = scenario === "foreign-approval";
const crashAfterAccept = scenario === "crash-after-accept";
const nonSteerable = scenario === "non-steerable";
const historyUnavailable = ["history-unavailable", "history-unavailable-active"].includes(scenario);
const httpServer = createServer();
const webSocketServer = new WebSocketServer({ server: httpServer });
const completedTurns = new Map();
const inProgressTurns = new Map();
let shuttingDown = false;
let disconnectedTurn = null;
let didDisconnect = false;
let foreignTurnActive = foreignApproval;
let didScheduleForeignApproval = false;
let nonSteerableTurnActive = nonSteerable;
let historyUnavailableTurnActive = scenario === "history-unavailable-active";
let didScheduleHistoryUnavailableTurn = false;

function log(value) {
  appendFileSync(eventLogPath, `${JSON.stringify(value)}\n`, "utf8");
}

function send(socket, value) {
  socket.send(JSON.stringify(value));
}

function thread() {
  const disconnectedActive = disconnectedTurn?.status === "inProgress";
  return {
    id: "thread-test",
    source: "cli",
    path: null,
    status: active || disconnectedActive || foreignTurnActive || nonSteerableTurnActive || historyUnavailableTurnActive || inProgressTurns.size > 0
      ? { type: "active", activeFlags: [] }
      : { type: "idle" },
    canAcceptDirectInput: active || disconnectedActive || foreignTurnActive || nonSteerableTurnActive || historyUnavailableTurnActive || inProgressTurns.size > 0,
    turns: [
      ...(active ? [{ id: "turn-active", status: "inProgress", items: [] }] : []),
      ...(foreignTurnActive ? [{ id: "turn-terminal", status: "inProgress", items: [] }] : []),
      ...(nonSteerableTurnActive ? [{ id: "turn-review", status: "inProgress", items: [] }] : []),
      ...(historyUnavailableTurnActive ? [{ id: "turn-history-hidden", status: "inProgress", items: [] }] : []),
      ...(disconnectedTurn ? [disconnectedTurn] : []),
      ...inProgressTurns.values(),
      ...completedTurns.values(),
    ],
  };
}

function completeTurn(socket, turnId, resultText, clientUserMessageId = "", input = []) {
  setTimeout(() => {
    if (socket.readyState !== 1) {
      return;
    }
    send(socket, {
      method: "item/completed",
      params: {
        threadId: "thread-test",
        turnId,
        item: {
          id: `agent-${turnId}`,
          type: "agentMessage",
          phase: "final_answer",
          text: resultText,
        },
      },
    });
    send(socket, {
      method: "turn/completed",
      params: {
        threadId: "thread-test",
        turn: { id: turnId, status: "completed" },
      },
    });
    completedTurns.set(turnId, {
      id: turnId,
      status: "completed",
      items: [
        {
          id: `user-${turnId}`,
          type: "userMessage",
          clientId: clientUserMessageId || null,
          content: input,
        },
        {
          id: `agent-${turnId}`,
          type: "agentMessage",
          phase: "final_answer",
          text: resultText,
        },
      ],
    });
  }, 75);
}

webSocketServer.on("connection", (socket) => {
  log({ type: "connection" });
  socket.once("close", () => {
    log({ type: "close" });
  });
  socket.on("message", (data) => {
    const message = JSON.parse(data.toString());
    log({ type: "request", message });
    if (!message.method || message.id === undefined) {
      return;
    }
    if (message.method === "initialize") {
      send(socket, { id: message.id, result: { ok: true } });
      return;
    }
    if (message.method === "thread/resume" || message.method === "thread/start") {
      send(socket, { id: message.id, result: { thread: thread() } });
      if (historyUnavailableTurnActive && !didScheduleHistoryUnavailableTurn) {
        didScheduleHistoryUnavailableTurn = true;
        setTimeout(() => {
          historyUnavailableTurnActive = false;
          log({ type: "historyUnavailableTurnCompleted", turnId: "turn-history-hidden" });
        }, 125);
      }
      if (foreignApproval && !didScheduleForeignApproval) {
        didScheduleForeignApproval = true;
        setTimeout(() => {
          if (socket.readyState !== 1) return;
          send(socket, {
            id: "approval-terminal",
            method: "item/commandExecution/requestApproval",
            params: {
              threadId: "thread-test",
              turnId: "turn-terminal",
              command: ["echo", "terminal-owned"],
            },
          });
        }, 10);
        setTimeout(() => {
          foreignTurnActive = false;
          log({ type: "foreignTurnCompleted", turnId: "turn-terminal" });
          completedTurns.set("turn-terminal", {
            id: "turn-terminal",
            status: "completed",
            items: [],
          });
          for (const client of webSocketServer.clients) {
            if (client.readyState !== 1) continue;
            send(client, {
              method: "turn/completed",
              params: {
                threadId: "thread-test",
                turn: { id: "turn-terminal", status: "completed" },
              },
            });
          }
        }, 125);
      }
      return;
    }
    if (message.method === "turn/start") {
      const turnId = "turn-started";
      send(socket, { id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
      if (crashAfterAccept) {
        const acceptedTurn = {
          id: turnId,
          status: "inProgress",
          items: [
            {
              id: `user-${turnId}`,
              type: "userMessage",
              clientId: message.params?.clientUserMessageId || null,
              content: message.params?.input || [],
            },
          ],
        };
        inProgressTurns.set(turnId, acceptedTurn);
        log({
          type: "turnAccepted",
          turnId,
          clientUserMessageId: message.params?.clientUserMessageId || null,
        });
        setTimeout(() => {
          inProgressTurns.delete(turnId);
          const completedTurn = {
            ...acceptedTurn,
            status: "completed",
            items: [
              ...acceptedTurn.items,
              {
                id: `agent-${turnId}`,
                type: "agentMessage",
                phase: "final_answer",
                text: "shared crash recovery response",
              },
            ],
          };
          completedTurns.set(turnId, completedTurn);
          for (const client of webSocketServer.clients) {
            if (client.readyState !== 1) continue;
            send(client, {
              method: "item/completed",
              params: {
                threadId: "thread-test",
                turnId,
                item: completedTurn.items[1],
              },
            });
            send(client, {
              method: "turn/completed",
              params: {
                threadId: "thread-test",
                turn: { id: turnId, status: "completed" },
              },
            });
          }
        }, 500);
        return;
      }
      if (foreignApproval) {
        send(socket, {
          id: "approval-clawdad",
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "thread-test",
            turnId,
            command: ["echo", "clawdad-owned"],
          },
        });
      }
      if (disconnectOnce && !didDisconnect) {
        didDisconnect = true;
        disconnectedTurn = {
          id: turnId,
          status: "inProgress",
          items: [
            {
              id: `user-${turnId}`,
              type: "userMessage",
              clientId: message.params?.clientUserMessageId || null,
              content: message.params?.input || [],
            },
          ],
        };
        setTimeout(() => socket.terminate(), 15);
        setTimeout(() => {
          disconnectedTurn = null;
          const completedTurn = {
            id: turnId,
            status: "completed",
            items: [
              {
                id: `user-${turnId}`,
                type: "userMessage",
                clientId: message.params?.clientUserMessageId || null,
                content: message.params?.input || [],
              },
              {
                id: `agent-${turnId}`,
                type: "agentMessage",
                phase: "final_answer",
                text: "shared reconnect response",
              },
            ],
          };
          completedTurns.set(turnId, completedTurn);
          for (const client of webSocketServer.clients) {
            if (client.readyState !== 1) continue;
            send(client, {
              method: "item/completed",
              params: {
                threadId: "thread-test",
                turnId,
                item: completedTurn.items[1],
              },
            });
            send(client, {
              method: "turn/completed",
              params: {
                threadId: "thread-test",
                turn: { id: turnId, status: "completed" },
              },
            });
          }
        }, 150);
        return;
      }
      completeTurn(
        socket,
        turnId,
        "shared start response",
        message.params?.clientUserMessageId,
        message.params?.input,
      );
      return;
    }
    if (message.method === "turn/steer") {
      if (nonSteerable) {
        send(socket, {
          id: message.id,
          error: {
            code: "activeTurnNotSteerable",
            message: "cannot steer a review turn",
            data: { type: "review", turnId: "turn-review" },
          },
        });
        setTimeout(() => {
          nonSteerableTurnActive = false;
          completedTurns.set("turn-review", {
            id: "turn-review",
            status: "completed",
            items: [],
          });
          for (const client of webSocketServer.clients) {
            if (client.readyState !== 1) continue;
            send(client, {
              method: "turn/completed",
              params: {
                threadId: "thread-test",
                turn: { id: "turn-review", status: "completed" },
              },
            });
          }
        }, 100);
        return;
      }
      const turnId = message.params?.expectedTurnId || "turn-active";
      send(socket, { id: message.id, result: { turn: { id: turnId, status: "inProgress" } } });
      completeTurn(
        socket,
        turnId,
        "shared steer response",
        message.params?.clientUserMessageId,
        message.params?.input,
      );
      return;
    }
    if (message.method === "thread/read") {
      if (historyUnavailable && message.params?.includeTurns === true) {
        send(socket, { id: message.id, error: { message: "list_turns is not supported yet" } });
        return;
      }
      const currentThread = thread();
      send(socket, {
        id: message.id,
        result: {
          thread: historyUnavailable
            ? { ...currentThread, turns: [] }
            : currentThread,
        },
      });
      return;
    }
    send(socket, { id: message.id, error: { message: `unsupported test method: ${message.method}` } });
  });
});

function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const socket of webSocketServer.clients) {
    socket.terminate();
  }
  webSocketServer.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 500).unref?.();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

httpServer.listen(socketPath, () => {
  process.stdout.write("READY\n");
});
