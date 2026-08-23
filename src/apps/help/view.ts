import {
  buildMap,
  edgeApp,
  edgeNode,
  edgePop,
  inputEdges,
  rootBackToHome,
  siblingListEdges,
} from "../../app-kit/index.ts";
import type {
  AppLocation,
  NavigationMap,
  NodePayload,
  RefreshExtras,
  RefreshResult,
} from "../../core/types.ts";
import { HELP_APP_ID, NODE, PRACTICE_IDS } from "./ids.ts";

export type HelpViewDeps = {
  readonly rootAppId: string;
};

const WELCOME_LABEL = [
  "Welcome to Now I See, an app purpose-built for people using screen readers.",
  "For simplicity, each page only displays a single item of text.",
  "You can navigate by tapping the top, bottom, left, or right of the screen, or by using the arrow keys.",
  "Now navigate right by tapping the right side of the screen or pressing the right arrow key.",
].join(" ");

const BACK_PRACTICE_LABEL = [
  "To go to a previous screen, navigate left by tapping the left side of the screen or pressing the left arrow key.",
  "Try it now, then return to this screen and navigate right.",
].join(" ");

const ITEM1_LABEL =
  "This is the first item in a list. Navigate down by tapping the bottom of the screen or pressing the down arrow key.";
const ITEM2_LABEL = "This is the second item in a list. Now navigate down again.";
const ITEM3_LABEL = [
  "This is the third item.",
  "Many lists wrap back to the first item when you get to the end.",
  "You can try it once you get to the end of this list if you want.",
].join(" ");
const ITEM4_LABEL = [
  "This is the fourth and final item in this list.",
  "Now let's try entering text in an input box.",
  "Navigate right when you are ready to begin.",
].join(" ");

const TYPE_PROMPT_LABEL = [
  "The next page is an input box.",
  "Enter text in the box, then use the tab key or your native screen gestures to find and click the Cancel or Done buttons on the page.",
].join(" ");

export function openHelp(deps: HelpViewDeps, path: string, extras: RefreshExtras = {}): RefreshResult {
  return viewFor(deps, tipForPath(path), extras);
}

export function refreshHelp(
  deps: HelpViewDeps,
  tipId: string | undefined,
  extras: RefreshExtras = {},
): RefreshResult {
  return viewFor(deps, tipId && isKnown(tipId) ? tipId : NODE.welcome, extras);
}

function viewFor(deps: HelpViewDeps, tipId: string, extras: RefreshExtras): RefreshResult {
  const payloads = payloadsFor(extras.inputText);
  const tip = payloads.get(tipId) ?? payloads.get(NODE.welcome)!;
  return {
    navigationMap: helpMap(deps.rootAppId),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(tip.id),
  };
}

function payloadsFor(inputText: string | undefined): Map<string, NodePayload> {
  return new Map<string, NodePayload>([
    [NODE.welcome, { id: NODE.welcome, label: WELCOME_LABEL }],
    [NODE.backPractice, { id: NODE.backPractice, label: BACK_PRACTICE_LABEL }],
    [NODE.item1, { id: NODE.item1, label: ITEM1_LABEL }],
    [NODE.item2, { id: NODE.item2, label: ITEM2_LABEL }],
    [NODE.item3, { id: NODE.item3, label: ITEM3_LABEL }],
    [NODE.item4, { id: NODE.item4, label: ITEM4_LABEL }],
    [NODE.typePrompt, { id: NODE.typePrompt, label: TYPE_PROMPT_LABEL }],
    [NODE.input, { id: NODE.input, label: "", kind: "input" }],
    [NODE.done, { id: NODE.done, label: doneLabelFor(inputText) }],
  ]);
}

function doneLabelFor(inputText: string | undefined): string {
  const typed = inputText ?? "";
  return [
    `You typed "${typed}".`,
    "This concludes the tutorial.",
    "When you navigate right, you will reach the home screen.",
    "Navigate up or down on the home screen to see available apps, including the help app, which will launch this tutorial again.",
  ].join(" ");
}

function helpMap(rootAppId: string): NavigationMap {
  return buildMap(
    rootBackToHome(NODE.welcome, rootAppId),
    {
      [NODE.welcome]: {
        enter: edgeNode(NODE.backPractice, "push"),
      },
      [NODE.backPractice]: {
        enter: edgeNode(NODE.item1, "push"),
        back: edgePop(),
      },
    },
    siblingListEdges([...PRACTICE_IDS], { wrap: true }),
    {
      [NODE.item1]: { back: edgePop() },
      [NODE.item2]: { back: edgePop() },
      [NODE.item3]: { back: edgePop() },
      [NODE.item4]: {
        enter: edgeNode(NODE.typePrompt, "push"),
        back: edgePop(),
      },
      [NODE.typePrompt]: {
        enter: edgeNode(NODE.input, "push"),
        back: edgePop(),
      },
    },
    inputEdges(NODE.input, {
      commitTo: NODE.done,
      backTo: NODE.typePrompt,
    }),
    {
      [NODE.done]: {
        enter: edgeApp({ appId: rootAppId, path: "/" }),
        back: edgeApp({ appId: rootAppId, path: "/" }),
      },
    },
  );
}

function tipForPath(path: string): string {
  switch (path) {
    case "/back":
      return NODE.backPractice;
    case "/practice/1":
      return NODE.item1;
    case "/practice/2":
      return NODE.item2;
    case "/practice/3":
      return NODE.item3;
    case "/practice/4":
      return NODE.item4;
    case "/type":
      return NODE.typePrompt;
    case "/type/input":
      return NODE.input;
    case "/done":
      return NODE.done;
    default:
      return NODE.welcome;
  }
}

function locationFor(tipId: string): AppLocation {
  switch (tipId) {
    case NODE.backPractice:
      return { appId: HELP_APP_ID, path: "/back" };
    case NODE.item1:
      return { appId: HELP_APP_ID, path: "/practice/1" };
    case NODE.item2:
      return { appId: HELP_APP_ID, path: "/practice/2" };
    case NODE.item3:
      return { appId: HELP_APP_ID, path: "/practice/3" };
    case NODE.item4:
      return { appId: HELP_APP_ID, path: "/practice/4" };
    case NODE.typePrompt:
      return { appId: HELP_APP_ID, path: "/type" };
    case NODE.input:
      return { appId: HELP_APP_ID, path: "/type/input" };
    case NODE.done:
      return { appId: HELP_APP_ID, path: "/done" };
    default:
      return { appId: HELP_APP_ID, path: "/" };
  }
}

function isKnown(tipId: string): boolean {
  return (
    tipId === NODE.welcome ||
    tipId === NODE.backPractice ||
    tipId === NODE.typePrompt ||
    tipId === NODE.input ||
    tipId === NODE.done ||
    (PRACTICE_IDS as readonly string[]).includes(tipId)
  );
}
