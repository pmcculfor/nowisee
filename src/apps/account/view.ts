import type { AccountFlowStore } from "./types.ts";
import {
  buildMap,
  edgeAction,
  edgeNode,
  edgePop,
  edgeToHome,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
  StackEntry,
} from "../../core/types.ts";
import { ACCOUNT_APP_ID, NODE } from "./ids.ts";

export type AccountViewDeps = {
  readonly rootAppId: string;
  readonly flow: AccountFlowStore;
};

const START_LABEL = "Sign in or register";
const EMAIL_PROMPT_LABEL = "Please enter your email on the next screen.";
const CODE_SENT_LABEL = "We sent a sign-in code to that email. Enter it on the next screen.";
const CODE_THROTTLED_LABEL = "Please wait before requesting another sign-in code.";
const SETTINGS_LABEL = "Settings. This screen is not available yet.";
const SIGN_OUT_LABEL = "Sign out";
const AUTH_WARM_LABEL = "Signing in…";
const SIGN_OUT_WARM_LABEL = "Signing out…";
const SIGNED_OUT_LABEL = "You are signed out.";
const AUTH_FAILED_LABEL = "Sign-in was unsuccessful.";

const SIGNED_OUT_IDS = [
  NODE.start,
  NODE.emailPrompt,
  NODE.email,
  NODE.codePrompt,
  NODE.code,
  NODE.auth,
] as const;

export async function openAccount(
  deps: AccountViewDeps,
  path: string,
  ctx: AppServerContext | undefined,
): Promise<RefreshResult> {
  const userId = ctx?.userId ?? null;
  if (userId) {
    if (path === "/sign-out") {
      return signedInView(deps, NODE.signOut, ctx);
    }
    return signedInView(deps, NODE.settings, ctx);
  }
  if (path === "/code/input") {
    return signedOutView(deps, NODE.code, ctx);
  }
  if (path === "/code") {
    return signedOutView(deps, NODE.codePrompt, ctx);
  }
  if (path === "/email/input") {
    return signedOutView(deps, NODE.email, ctx);
  }
  if (path === "/email") {
    return signedOutView(deps, NODE.emailPrompt, ctx);
  }
  return signedOutView(deps, NODE.start, ctx);
}

export async function refreshAccount(
  deps: AccountViewDeps,
  stack: readonly StackEntry[],
  extras: RefreshExtras,
  ctx: AppServerContext | undefined,
): Promise<RefreshResult> {
  const tipId = stack[stack.length - 1]?.nodeId;
  const userId = ctx?.userId ?? null;

  if (extras.action) {
    return applyAction(deps, stack, extras, ctx);
  }

  if (userId) {
    if (tipId === NODE.signOut || tipId === NODE.signOutStatus) {
      return signedInView(deps, tipId === NODE.signOutStatus ? NODE.signOutStatus : NODE.signOut, ctx);
    }
    if (tipId === NODE.settings) {
      return signedInView(deps, NODE.settings, ctx);
    }
    if (tipId === NODE.auth) {
      return authStatusView(deps, "You are signed in.", true);
    }
    return signedInView(deps, NODE.settings, ctx);
  }

  if (tipId === NODE.auth) {
    return authStatusView(deps, AUTH_WARM_LABEL, false);
  }
  if (tipId && (SIGNED_OUT_IDS as readonly string[]).includes(tipId)) {
    return signedOutView(deps, tipId, ctx);
  }
  if (tipId === NODE.signOutStatus) {
    return signedOutStatusView(deps);
  }
  return signedOutView(deps, NODE.start, ctx);
}

async function applyAction(
  deps: AccountViewDeps,
  stack: readonly StackEntry[],
  extras: RefreshExtras,
  ctx: AppServerContext | undefined,
): Promise<RefreshResult> {
  const tipId = stack[stack.length - 1]?.nodeId;
  const sessionId = ctx?.sessionId;
  const identity = ctx?.identity;

  if (tipId === NODE.codePrompt && sessionId) {
    if (!identity) {
      return codePromptStatusView(AUTH_FAILED_LABEL);
    }
    const email = extras.inputText ?? "";
    deps.flow.setEmail(sessionId, email);
    const outcome = await identity.requestSignIn(email);
    if (!outcome.ok && outcome.reason === "throttled") {
      return codePromptStatusView(CODE_THROTTLED_LABEL);
    }
    if (!outcome.ok) {
      return codePromptStatusView(AUTH_FAILED_LABEL);
    }
    return signedOutView(deps, NODE.codePrompt, ctx);
  }

  if (tipId === NODE.auth) {
    if (!identity || !sessionId) {
      return authStatusView(deps, "Sign-in is not available.", false);
    }
    const email = deps.flow.getEmail(sessionId) ?? "";
    const outcome = await identity.verifySignIn(extras.inputText ?? "");
    if (outcome.ok) {
      deps.flow.clear(sessionId);
      return authStatusView(deps, `You are signed in as ${email.trim().toLowerCase()}.`, true);
    }
    return authStatusView(deps, AUTH_FAILED_LABEL, false);
  }

  if (tipId === NODE.signOutStatus) {
    if (identity && sessionId) {
      await identity.signOut();
      deps.flow.clear(sessionId);
    }
    return signedOutStatusView(deps);
  }

  if (ctx?.userId) {
    return signedInView(deps, NODE.settings, ctx);
  }
  return signedOutView(deps, NODE.start, ctx);
}

function signedOutView(
  deps: AccountViewDeps,
  tipId: string,
  _ctx: AppServerContext | undefined,
): RefreshResult {
  const start: NodePayload = { id: NODE.start, label: START_LABEL };
  const emailPrompt: NodePayload = { id: NODE.emailPrompt, label: EMAIL_PROMPT_LABEL };
  const email: NodePayload = {
    id: NODE.email,
    label: "",
    kind: "input",
    autocomplete: "username",
  };
  const codePrompt: NodePayload = { id: NODE.codePrompt, label: CODE_SENT_LABEL };
  const code: NodePayload = {
    id: NODE.code,
    label: "",
    kind: "input",
    autocomplete: "off",
  };
  const auth: NodePayload = { id: NODE.auth, label: AUTH_WARM_LABEL };

  const payloads = new Map<string, NodePayload>([
    [NODE.start, start],
    [NODE.emailPrompt, emailPrompt],
    [NODE.email, email],
    [NODE.codePrompt, codePrompt],
    [NODE.code, code],
    [NODE.auth, auth],
  ]);
  const tip = payloads.get(tipId) ?? start;

  const navigationMap = buildMap(
    {
      [NODE.start]: {
        enter: edgeNode(NODE.emailPrompt, "push"),
      },
      [NODE.emailPrompt]: {
        enter: edgeNode(NODE.email, "push"),
      },
      [NODE.codePrompt]: {
        enter: edgeNode(NODE.code, "push"),
      },
    },
    rootBackToHome(NODE.start, deps.rootAppId, ACCOUNT_APP_ID),
    {
      [NODE.emailPrompt]: { back: edgePop() },
      [NODE.codePrompt]: { back: edgePop() },
    },
    inputEdges(NODE.email, {
      commitTo: NODE.codePrompt,
      backTo: "pop",
      action: true,
    }),
    inputEdges(NODE.code, {
      commitTo: NODE.auth,
      backTo: "pop",
      action: true,
    }),
    {
      [NODE.auth]: {
        back: edgePop(),
      },
    },
  );

  return {
    navigationMap,
    warm: [start, emailPrompt, email, codePrompt, code, auth],
    node: tip,
    location: locationFor(tip.id),
  };
}

function signedInView(
  deps: AccountViewDeps,
  tipId: string,
  _ctx: AppServerContext | undefined,
): RefreshResult {
  const settings: NodePayload = { id: NODE.settings, label: SETTINGS_LABEL };
  const signOut: NodePayload = { id: NODE.signOut, label: SIGN_OUT_LABEL };
  const signOutStatus: NodePayload = { id: NODE.signOutStatus, label: SIGN_OUT_WARM_LABEL };

  const payloads = new Map<string, NodePayload>([
    [NODE.settings, settings],
    [NODE.signOut, signOut],
    [NODE.signOutStatus, signOutStatus],
  ]);
  const tip = payloads.get(tipId) ?? settings;

  const navigationMap = buildMap(
    siblingListEdges([NODE.settings, NODE.signOut]),
    rootBackToHome(NODE.settings, deps.rootAppId, ACCOUNT_APP_ID),
    rootBackToHome(NODE.signOut, deps.rootAppId, ACCOUNT_APP_ID),
    {
      [NODE.signOut]: {
        enter: edgeAction(NODE.signOutStatus),
      },
    },
    {
      [NODE.signOutStatus]: {
        enter: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
        back: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
      },
    },
  );

  return {
    navigationMap,
    warm: [settings, signOut, signOutStatus],
    node: tip,
    location: locationFor(tip.id),
  };
}

function codePromptStatusView(label: string): RefreshResult {
  const node: NodePayload = { id: NODE.codePrompt, label };
  const email: NodePayload = {
    id: NODE.email,
    label: "",
    kind: "input",
    autocomplete: "username",
  };
  return {
    navigationMap: buildMap({
      [NODE.codePrompt]: {
        enter: edgePop(),
        back: edgePop(),
      },
    }),
    warm: [node, email],
    node,
    location: null,
  };
}

function authStatusView(
  deps: AccountViewDeps,
  label: string,
  signedIn: boolean,
): RefreshResult {
  const node: NodePayload = { id: NODE.auth, label };
  const code: NodePayload = {
    id: NODE.code,
    label: "",
    kind: "input",
    autocomplete: "off",
  };
  let navigationMap: NavigationMap;
  if (signedIn) {
    navigationMap = buildMap({
      [NODE.auth]: {
        enter: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
        back: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
      },
    });
  } else {
    navigationMap = buildMap({
      [NODE.auth]: {
        enter: edgePop(),
        back: edgePop(),
      },
    });
  }
  return {
    navigationMap,
    warm: [node, code],
    node,
    location: null,
  };
}

function signedOutStatusView(deps: AccountViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.signOutStatus, label: SIGNED_OUT_LABEL };
  return {
    navigationMap: buildMap({
      [NODE.signOutStatus]: {
        enter: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
        back: edgeToHome(deps.rootAppId, ACCOUNT_APP_ID),
      },
    }),
    warm: [node],
    node,
    location: null,
  };
}

function locationFor(tipId: string): AppLocation | null {
  switch (tipId) {
    case NODE.start:
      return { appId: ACCOUNT_APP_ID, path: "/" };
    case NODE.emailPrompt:
      return { appId: ACCOUNT_APP_ID, path: "/email" };
    case NODE.email:
      return { appId: ACCOUNT_APP_ID, path: "/email/input" };
    case NODE.codePrompt:
      return { appId: ACCOUNT_APP_ID, path: "/code" };
    case NODE.code:
      return { appId: ACCOUNT_APP_ID, path: "/code/input" };
    case NODE.settings:
      return { appId: ACCOUNT_APP_ID, path: "/" };
    case NODE.signOut:
      return { appId: ACCOUNT_APP_ID, path: "/sign-out" };
    default:
      return null;
  }
}
