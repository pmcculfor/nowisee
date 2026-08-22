import type { AccountFlowStore } from "./types.ts";
import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeNode,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  AppServerContext,
  AuthOutcome,
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
const SETTINGS_LABEL = "Settings. This screen is not available yet.";
const SIGN_OUT_LABEL = "Sign out";
const AUTH_WARM_LABEL = "Signing in…";
const SIGN_OUT_WARM_LABEL = "Signing out…";
const SIGNED_OUT_LABEL = "You are signed out.";

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
  if (path === "/password") {
    return signedOutView(deps, NODE.password, ctx);
  }
  if (path === "/email") {
    return signedOutView(deps, NODE.email, ctx);
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
    // Signed-in user on a signed-out node — repair to settings, do not teleport mid-workflow.
    if (tipId === NODE.auth) {
      return authStatusView(deps, "You are signed in.", ctx, true);
    }
    return signedInView(deps, NODE.settings, ctx);
  }

  if (tipId === NODE.auth) {
    return authStatusView(deps, AUTH_WARM_LABEL, ctx, false);
  }
  if (tipId === NODE.password || tipId === NODE.email || tipId === NODE.start) {
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

  if (tipId === NODE.password && sessionId) {
    deps.flow.setEmail(sessionId, extras.inputText ?? "");
    return signedOutView(deps, NODE.password, ctx);
  }

  if (tipId === NODE.auth) {
    if (!identity || !sessionId) {
      return authStatusView(deps, "Sign-in is not available.", ctx, false);
    }
    const email = deps.flow.getEmail(sessionId) ?? "";
    const password = extras.inputText ?? "";
    const outcome = await authenticate(identity, email, password);
    if (outcome.ok) {
      deps.flow.clear(sessionId);
      return authStatusView(deps, `You are signed in as ${email.trim().toLowerCase()}.`, ctx, true);
    }
    return authStatusView(deps, messageFor(outcome.reason), ctx, false);
  }

  if (tipId === NODE.signOutStatus) {
    if (identity && sessionId) {
      await identity.signOut();
      deps.flow.clear(sessionId);
    }
    return signedOutStatusView(deps);
  }

  // Unknown action tip: repair.
  if (ctx?.userId) {
    return signedInView(deps, NODE.settings, ctx);
  }
  return signedOutView(deps, NODE.start, ctx);
}

async function authenticate(
  identity: NonNullable<AppServerContext["identity"]>,
  email: string,
  password: string,
): Promise<AuthOutcome> {
  const registered = await identity.register(email, password);
  if (registered.ok) {
    return registered;
  }
  if (registered.reason === "email-taken") {
    return identity.signIn(email, password);
  }
  return registered;
}

function messageFor(reason: Extract<AuthOutcome, { ok: false }>["reason"]): string {
  switch (reason) {
    case "weak-password":
      return "That password is too short. Use at least 8 characters.";
    case "registration-closed":
      return "Registration is closed.";
    case "email-taken":
    case "invalid-credentials":
      return "That email or password did not match.";
  }
}

function signedOutView(
  deps: AccountViewDeps,
  tipId: string,
  _ctx: AppServerContext | undefined,
): RefreshResult {
  const start: NodePayload = { id: NODE.start, label: START_LABEL };
  const email: NodePayload = {
    id: NODE.email,
    label: "",
    kind: "input",
    autocomplete: "username",
  };
  const password: NodePayload = {
    id: NODE.password,
    label: "",
    kind: "input",
    secret: true,
    autocomplete: "current-password",
  };
  const auth: NodePayload = { id: NODE.auth, label: AUTH_WARM_LABEL };

  const payloads = new Map<string, NodePayload>([
    [NODE.start, start],
    [NODE.email, email],
    [NODE.password, password],
    [NODE.auth, auth],
  ]);
  const tip = payloads.get(tipId) ?? start;

  const navigationMap = buildMap(
    {
      [NODE.start]: {
        enter: edgeNode(NODE.email, "push"),
      },
    },
    rootBackToHome(NODE.start, deps.rootAppId),
    inputEdges(NODE.email, {
      commitTo: NODE.password,
      backTo: "pop",
      action: true,
    }),
    inputEdges(NODE.password, {
      commitTo: NODE.auth,
      backTo: "pop",
      action: true,
    }),
    {
      [NODE.auth]: {
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
      },
    },
  );

  return {
    navigationMap,
    warm: [start, email, password, auth],
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
    rootBackToHome(NODE.settings, deps.rootAppId),
    rootBackToHome(NODE.signOut, deps.rootAppId),
    {
      [NODE.signOut]: {
        enter: edgeAction(NODE.signOutStatus),
      },
    },
    {
      [NODE.signOutStatus]: {
        enter: edgeApp({ appId: deps.rootAppId, path: "/" }),
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
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

function authStatusView(
  deps: AccountViewDeps,
  label: string,
  _ctx: AppServerContext | undefined,
  signedIn: boolean,
): RefreshResult {
  const node: NodePayload = { id: NODE.auth, label };
  let navigationMap: NavigationMap;
  if (signedIn) {
    navigationMap = buildMap({
      [NODE.auth]: {
        enter: edgeApp({ appId: ACCOUNT_APP_ID, path: "/" }),
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
      },
    });
  } else {
    navigationMap = buildMap({
      [NODE.auth]: {
        enter: edgeNode(NODE.password, "replace"),
        back: edgeNode(NODE.password, "replace"),
      },
    });
  }
  return {
    navigationMap,
    warm: [node, { id: NODE.password, label: "", kind: "input", secret: true, autocomplete: "current-password" }],
    node,
    location: null,
  };
}

function signedOutStatusView(deps: AccountViewDeps): RefreshResult {
  const node: NodePayload = { id: NODE.signOutStatus, label: SIGNED_OUT_LABEL };
  return {
    navigationMap: buildMap({
      [NODE.signOutStatus]: {
        enter: edgeApp({ appId: deps.rootAppId, path: "/" }),
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
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
    case NODE.email:
      return { appId: ACCOUNT_APP_ID, path: "/email" };
    case NODE.password:
      return { appId: ACCOUNT_APP_ID, path: "/password" };
    case NODE.settings:
      return { appId: ACCOUNT_APP_ID, path: "/" };
    case NODE.signOut:
      return { appId: ACCOUNT_APP_ID, path: "/sign-out" };
    default:
      return null;
  }
}
