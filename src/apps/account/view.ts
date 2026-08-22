import type { AccountFlowStore } from "./types.ts";
import {
  buildMap,
  edgeAction,
  edgeApp,
  edgeNode,
  edgePop,
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
const EMAIL_PROMPT_LABEL = "Please enter your email.";
const PASSWORD_PROMPT_LABEL = "Please enter your password.";
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
  NODE.passwordPrompt,
  NODE.password,
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
  if (path === "/password/input") {
    return signedOutView(deps, NODE.password, ctx);
  }
  if (path === "/password") {
    return signedOutView(deps, NODE.passwordPrompt, ctx);
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

  if (tipId === NODE.passwordPrompt && sessionId) {
    deps.flow.setEmail(sessionId, extras.inputText ?? "");
    return signedOutView(deps, NODE.passwordPrompt, ctx);
  }

  if (tipId === NODE.auth) {
    if (!identity || !sessionId) {
      return authStatusView(deps, "Sign-in is not available.", false);
    }
    const email = deps.flow.getEmail(sessionId) ?? "";
    const password = extras.inputText ?? "";
    const outcome = await authenticate(identity, email, password);
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
  const passwordPrompt: NodePayload = { id: NODE.passwordPrompt, label: PASSWORD_PROMPT_LABEL };
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
    [NODE.emailPrompt, emailPrompt],
    [NODE.email, email],
    [NODE.passwordPrompt, passwordPrompt],
    [NODE.password, password],
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
      [NODE.passwordPrompt]: {
        enter: edgeNode(NODE.password, "push"),
      },
    },
    rootBackToHome(NODE.start, deps.rootAppId),
    {
      [NODE.emailPrompt]: { back: edgePop() },
      [NODE.passwordPrompt]: { back: edgePop() },
    },
    inputEdges(NODE.email, {
      commitTo: NODE.passwordPrompt,
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
        back: edgePop(),
      },
    },
  );

  return {
    navigationMap,
    warm: [start, emailPrompt, email, passwordPrompt, password, auth],
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
  signedIn: boolean,
): RefreshResult {
  const node: NodePayload = { id: NODE.auth, label };
  const password: NodePayload = {
    id: NODE.password,
    label: "",
    kind: "input",
    secret: true,
    autocomplete: "current-password",
  };
  let navigationMap: NavigationMap;
  if (signedIn) {
    navigationMap = buildMap({
      [NODE.auth]: {
        enter: edgeApp({ appId: deps.rootAppId, path: "/" }),
        back: edgeApp({ appId: deps.rootAppId, path: "/" }),
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
    warm: [node, password],
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
    case NODE.emailPrompt:
      return { appId: ACCOUNT_APP_ID, path: "/email" };
    case NODE.email:
      return { appId: ACCOUNT_APP_ID, path: "/email/input" };
    case NODE.passwordPrompt:
      return { appId: ACCOUNT_APP_ID, path: "/password" };
    case NODE.password:
      return { appId: ACCOUNT_APP_ID, path: "/password/input" };
    case NODE.settings:
      return { appId: ACCOUNT_APP_ID, path: "/" };
    case NODE.signOut:
      return { appId: ACCOUNT_APP_ID, path: "/sign-out" };
    default:
      return null;
  }
}
