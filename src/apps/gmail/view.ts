import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeExternal,
  edgeNode,
  edgePop,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
  signedOut,
  splitText,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NavigationMap,
  NodePayload,
  OAuthCapability,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import {
  chunkNodeId,
  GMAIL_APP_ID,
  GMAIL_OAUTH_SLOT,
  messageNodeId,
  NODE,
  parseChunkNodeId,
  parseMessageNodeId,
  subjectLabel,
} from "./ids.ts";
import { GmailClientError, type GmailClient, type GmailStore, type InboxMessage } from "./types.ts";

export type GmailViewDeps = {
  readonly rootAppId: string;
  readonly store: GmailStore;
  readonly client: GmailClient;
};

const SIGNED_OUT_TEXT = "Sign in to use Gmail.";
const CONNECT_LABEL = "Connect Gmail";
const COMPOSE_LABEL = "Compose";
const DISCONNECT_LABEL = "Disconnect Gmail";
const DISCONNECTED_LABEL = "Gmail disconnected.";
const UNAVAILABLE_LABEL = "Gmail is not configured.";
const LOAD_ERROR_LABEL = "Couldn't load inbox. Try again.";
const SENDING_LABEL = "Sending…";
const SENT_LABEL = "Sent.";

export async function openGmailPath(
  deps: GmailViewDeps,
  path: string,
  extras: RefreshExtras,
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  return buildGmailView(deps, tipIdForPath(path), extras, ctx);
}

export async function buildGmailView(
  deps: GmailViewDeps,
  tipId: string | null,
  extras: RefreshExtras,
  ctx?: AppServerContext,
): Promise<RefreshResult> {
  const ownerId = ctx?.userId ?? null;
  if (!ctx || !ownerId) {
    return signedOutGmail(deps, ctx);
  }
  const oauth = ctx.oauth;
  if (!oauth) {
    return unavailable(deps);
  }

  if (extras.action && tipId) {
    return applyAction(deps, ownerId, tipId, extras, ctx, oauth);
  }

  const status = await oauthStatus(oauth);
  if (status !== "ready") {
    return connectView(deps, oauth, ctx);
  }

  return connectedView(deps, ownerId, tipId, extras, ctx, oauth);
}

function signedOutGmail(deps: GmailViewDeps, ctx: AppServerContext | undefined): RefreshResult {
  return signedOut({
    accountAppId: ctx?.accountAppId ?? deps.rootAppId,
    rootAppId: deps.rootAppId,
    text: SIGNED_OUT_TEXT,
  });
}

async function applyAction(
  deps: GmailViewDeps,
  ownerId: string,
  tipId: string,
  extras: RefreshExtras,
  ctx: AppServerContext,
  oauth: OAuthCapability,
): Promise<RefreshResult> {
  if (tipId === NODE.disconnectStatus) {
    await oauth.disconnect(GMAIL_OAUTH_SLOT);
    await deps.store.replaceInbox(ownerId, []);
    await deps.store.clearDraft(ownerId);
    return disconnectedView(deps);
  }

  if (tipId === NODE.composeSubject) {
    await deps.store.saveDraft(ownerId, { to: extras.inputText ?? "", sendResult: null });
    return connectedView(deps, ownerId, NODE.composeSubject, {}, ctx, oauth);
  }

  if (tipId === NODE.composeBody) {
    await deps.store.saveDraft(ownerId, { subject: extras.inputText ?? "", sendResult: null });
    return connectedView(deps, ownerId, NODE.composeBody, {}, ctx, oauth);
  }

  if (tipId === NODE.composeSent) {
    return sendMail(deps, ownerId, extras.inputText ?? "", extras, ctx, oauth);
  }

  return connectedView(deps, ownerId, tipId, extras, ctx, oauth);
}

async function sendMail(
  deps: GmailViewDeps,
  ownerId: string,
  body: string,
  extras: RefreshExtras,
  ctx: AppServerContext,
  oauth: OAuthCapability,
): Promise<RefreshResult> {
  const draft = await deps.store.saveDraft(ownerId, { body, sendResult: null });
  const to = draft.to.trim();
  if (!to) {
    await deps.store.saveDraft(ownerId, {
      sendResult: { ok: false, message: "Send failed. To address is missing." },
    });
    return connectedView(deps, ownerId, NODE.composeSent, extras, ctx, oauth);
  }

  try {
    const token = await oauth.getAccessToken(GMAIL_OAUTH_SLOT);
    let from: string | undefined;
    try {
      from = (await deps.client.getProfile(token, extras.signal)).email;
    } catch {
      from = undefined;
    }
    await deps.client.send(
      token,
      { from, to, subject: draft.subject, body: draft.body },
      extras.signal,
    );
    await deps.store.saveDraft(ownerId, { sendResult: { ok: true } });
  } catch (err) {
    if (isReconnect(err)) {
      return connectView(deps, oauth, ctx);
    }
    await deps.store.saveDraft(ownerId, {
      sendResult: { ok: false, message: "Send failed. Try again." },
    });
  }
  return connectedView(deps, ownerId, NODE.composeSent, extras, ctx, oauth);
}

async function connectedView(
  deps: GmailViewDeps,
  ownerId: string,
  requestedTipId: string | null,
  extras: RefreshExtras,
  ctx: AppServerContext,
  oauth: OAuthCapability,
): Promise<RefreshResult> {
  let token: string;
  try {
    token = await oauth.getAccessToken(GMAIL_OAUTH_SLOT);
  } catch (err) {
    if (isReconnect(err)) {
      return connectView(deps, oauth, ctx);
    }
    throw err;
  }

  let messages: readonly InboxMessage[];
  try {
    const cached = await deps.store.listInbox(ownerId);
    messages = await deps.client.listInbox(token, { signal: extras.signal, cached });
    await deps.store.replaceInbox(ownerId, messages);
  } catch (err) {
    if (isReconnect(err)) {
      return connectView(deps, oauth, ctx);
    }
    return loadError(deps);
  }

  const draft = await deps.store.getDraft(ownerId);
  const tipGuess = requestedTipId ?? defaultListTip(messages);
  let bodies: ReadonlyMap<string, string[]>;
  try {
    bodies = await bodiesForTip(deps, token, tipGuess, messages, extras.signal);
  } catch (err) {
    if (isReconnect(err)) {
      return connectView(deps, oauth, ctx);
    }
    throw err;
  }
  return viewFromState(deps, messages, draft, requestedTipId, bodies);
}

async function bodiesForTip(
  deps: GmailViewDeps,
  token: string,
  tipId: string | null,
  messages: readonly InboxMessage[],
  signal?: AbortSignal,
): Promise<ReadonlyMap<string, string[]>> {
  if (!tipId) {
    return new Map();
  }
  const messageId =
    parseChunkNodeId(tipId)?.messageId ?? parseMessageNodeId(tipId) ?? null;
  if (!messageId || !messages.some((m) => m.id === messageId)) {
    return new Map();
  }
  try {
    const text = await deps.client.getBody(token, messageId, signal);
    return new Map([[messageId, splitText(text)]]);
  } catch (err) {
    if (isReconnect(err)) {
      throw err;
    }
    return new Map([[messageId, ["Couldn't load this message."]]]);
  }
}

async function connectView(
  deps: GmailViewDeps,
  oauth: OAuthCapability,
  ctx: AppServerContext,
): Promise<RefreshResult> {
  try {
    const { authorizeUrl } = await oauth.start({ slot: GMAIL_OAUTH_SLOT });
    const node: NodePayload = { id: NODE.connect, label: CONNECT_LABEL };
    return {
      node,
      warm: [node],
      navigationMap: buildMap({
        [NODE.connect]: {
          enter: edgeExternal(authorizeUrl),
          back: edgeApp({ appId: deps.rootAppId, path: "/" }),
        },
      }),
      location: { appId: GMAIL_APP_ID, path: "/connect" },
    };
  } catch (err) {
    if (isOAuthCode(err, ["not-signed-in"])) {
      return signedOutGmail(deps, ctx);
    }
    return unavailable(deps);
  }
}

function unavailable(deps: GmailViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.unavailable, label: UNAVAILABLE_LABEL };
  return {
    node,
    warm: [node],
    navigationMap: buildMap(rootBackToHome(NODE.unavailable, deps.rootAppId)),
    location: { appId: GMAIL_APP_ID, path: "/" },
  };
}

function loadError(deps: GmailViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.loadError, label: LOAD_ERROR_LABEL };
  return {
    node,
    warm: [node],
    navigationMap: buildMap(rootBackToHome(NODE.loadError, deps.rootAppId)),
    location: { appId: GMAIL_APP_ID, path: "/" },
  };
}

function disconnectedView(deps: GmailViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.disconnectStatus, label: DISCONNECTED_LABEL };
  return {
    node,
    warm: [node],
    navigationMap: buildMap({
      [NODE.disconnectStatus]: {
        enter: edgeApp({ appId: deps.rootAppId, path: "/" }),
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
      },
    }),
    location: { appId: GMAIL_APP_ID, path: "/disconnect" },
  };
}

function viewFromState(
  deps: GmailViewDeps,
  messages: readonly InboxMessage[],
  draft: Awaited<ReturnType<GmailStore["getDraft"]>>,
  requestedTipId: string | null,
  bodies: ReadonlyMap<string, string[]>,
): RefreshResult {
  const payloads = new Map<string, NodePayload>();
  payloads.set(NODE.disconnect, { id: NODE.disconnect, label: DISCONNECT_LABEL });
  payloads.set(NODE.disconnectStatus, {
    id: NODE.disconnectStatus,
    label: "Disconnecting…",
  });
  payloads.set(NODE.compose, { id: NODE.compose, label: COMPOSE_LABEL });
  payloads.set(NODE.composeTo, { id: NODE.composeTo, label: draft.to, kind: "input" });
  payloads.set(NODE.composeSubject, {
    id: NODE.composeSubject,
    label: draft.subject,
    kind: "input",
  });
  payloads.set(NODE.composeBody, { id: NODE.composeBody, label: draft.body, kind: "input" });
  payloads.set(NODE.composeSent, {
    id: NODE.composeSent,
    label: sentLabel(draft.sendResult),
  });

  for (const message of messages) {
    const id = messageNodeId(message.id);
    payloads.set(id, { id, label: subjectLabel(message.from, message.subject) });
    const chunks = bodies.get(message.id);
    if (chunks) {
      chunks.forEach((label, index) => {
        const cid = chunkNodeId(message.id, index);
        payloads.set(cid, { id: cid, label: label || "Empty message" });
      });
    }
  }

  let tipId = requestedTipId ?? defaultListTip(messages);
  if (!payloads.has(tipId)) {
    const chunk = parseChunkNodeId(tipId);
    if (chunk && messages.some((m) => m.id === chunk.messageId)) {
      tipId = messageNodeId(chunk.messageId);
    } else {
      tipId = defaultListTip(messages);
    }
  }
  const tip = payloads.get(tipId)!;
  const listIds = [NODE.disconnect, NODE.compose, ...messages.map((m) => messageNodeId(m.id))];

  return {
    navigationMap: buildNavigationMap(deps.rootAppId, listIds, messages, bodies),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(tipId),
  };
}

function buildNavigationMap(
  rootAppId: string,
  listIds: readonly string[],
  messages: readonly InboxMessage[],
  bodies: ReadonlyMap<string, string[]>,
): NavigationMap {
  const fragments = [
    siblingListEdges(listIds, { wrap: false }),
    {
      [NODE.disconnect]: {
        enter: edgeAction(NODE.disconnectStatus, { stackBehavior: "replace" }),
      },
    },
    {
      [NODE.compose]: {
        enter: edgeNode(NODE.composeTo, "replace"),
      },
    },
    inputEdges(NODE.composeTo, {
      commitTo: NODE.composeSubject,
      backTo: NODE.compose,
      action: true,
      commitStackBehavior: "replace",
    }),
    inputEdges(NODE.composeSubject, {
      commitTo: NODE.composeBody,
      backTo: NODE.composeTo,
      action: true,
      commitStackBehavior: "replace",
    }),
    inputEdges(NODE.composeBody, {
      commitTo: NODE.composeSent,
      backTo: NODE.composeSubject,
      action: true,
      commitStackBehavior: "replace",
    }),
    {
      [NODE.composeSent]: {
        enter: edgeNode(NODE.compose, "replace"),
        back: edgeNode(NODE.compose, "replace"),
      },
    },
  ];

  for (const id of listIds) {
    fragments.push(rootBackToHome(id, rootAppId));
  }

  for (const message of messages) {
    const chunks = bodies.get(message.id) ?? [""];
    const mid = messageNodeId(message.id);
    const firstChunk = chunkNodeId(message.id, 0);
    fragments.push({
      [mid]: { enter: edgeNode(firstChunk, "push") },
    });
    const chunkIds = chunks.map((_, i) => chunkNodeId(message.id, i));
    fragments.push(siblingListEdges(chunkIds, { wrap: false }));
    for (const cid of chunkIds) {
      fragments.push({
        [cid]: { back: edgePop() },
      });
    }
  }

  return buildMap(...fragments);
}

function defaultListTip(messages: readonly InboxMessage[]): string {
  if (messages.length === 0) {
    return NODE.compose;
  }
  return messageNodeId(messages[0]!.id);
}

function tipIdForPath(path: string): string | null {
  if (path === "/" || path === "") {
    return null;
  }
  if (path === "/connect") {
    return NODE.connect;
  }
  if (path === "/disconnect") {
    return NODE.disconnect;
  }
  if (path === "/compose") {
    return NODE.compose;
  }
  if (path === "/compose/to") {
    return NODE.composeTo;
  }
  if (path === "/compose/subject") {
    return NODE.composeSubject;
  }
  if (path === "/compose/body") {
    return NODE.composeBody;
  }
  if (path === "/compose/sent") {
    return NODE.composeSent;
  }
  const chunk = /^\/msg\/([^/]+)\/p\/(\d+)\/?$/.exec(path);
  if (chunk) {
    return chunkNodeId(decodeURIComponent(chunk[1]!), Number(chunk[2]));
  }
  const msg = /^\/msg\/([^/]+)\/?$/.exec(path);
  if (msg) {
    return messageNodeId(decodeURIComponent(msg[1]!));
  }
  return NODE.compose;
}

function locationFor(tipId: string): AppLocation | null {
  if (tipId === NODE.connect) {
    return { appId: GMAIL_APP_ID, path: "/connect" };
  }
  if (tipId === NODE.disconnect || tipId === NODE.disconnectStatus) {
    return { appId: GMAIL_APP_ID, path: "/disconnect" };
  }
  if (tipId === NODE.compose) {
    return { appId: GMAIL_APP_ID, path: "/compose" };
  }
  if (tipId === NODE.composeTo) {
    return { appId: GMAIL_APP_ID, path: "/compose/to" };
  }
  if (tipId === NODE.composeSubject) {
    return { appId: GMAIL_APP_ID, path: "/compose/subject" };
  }
  if (tipId === NODE.composeBody) {
    return { appId: GMAIL_APP_ID, path: "/compose/body" };
  }
  if (tipId === NODE.composeSent) {
    return null;
  }
  const chunk = parseChunkNodeId(tipId);
  if (chunk) {
    return { appId: GMAIL_APP_ID, path: `/msg/${chunk.messageId}/p/${chunk.index}` };
  }
  const messageId = parseMessageNodeId(tipId);
  if (messageId) {
    return { appId: GMAIL_APP_ID, path: `/msg/${messageId}` };
  }
  return { appId: GMAIL_APP_ID, path: "/" };
}

function sentLabel(result: { ok: true } | { ok: false; message: string } | null): string {
  if (!result) {
    return SENDING_LABEL;
  }
  if (result.ok) {
    return SENT_LABEL;
  }
  return result.message;
}

async function oauthStatus(oauth: OAuthCapability): Promise<"missing" | "ready" | "needs-reconnect"> {
  try {
    return await oauth.status(GMAIL_OAUTH_SLOT);
  } catch (err) {
    if (isOAuthCode(err, ["not-signed-in"])) {
      return "missing";
    }
    throw err;
  }
}

function isReconnect(err: unknown): boolean {
  if (isOAuthCode(err, ["needs-reconnect", "missing"])) {
    return true;
  }
  return err instanceof GmailClientError && err.code === "unauthorized";
}

function isOAuthCode(err: unknown, codes: readonly string[]): boolean {
  if (typeof err !== "object" || err === null || !("code" in err)) {
    return false;
  }
  const code = (err as { code: unknown }).code;
  return typeof code === "string" && codes.includes(code);
}
