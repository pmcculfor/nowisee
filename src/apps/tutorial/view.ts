import {
  buildMap,
  edgeNode,
  edgePop,
  edgeToHome,
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
import { NODE, PRACTICE_IDS, TUTORIAL_APP_ID } from "./ids.ts";

export type TutorialViewDeps = {
  readonly rootAppId: string;
};

const WELCOME_LABEL = [
  "Welcome to Now I See, an app purpose-built for people using screen readers.",
  "For simplicity, only one chunk of text is displayed on the screen at a time.",
  "You access neighboring screens by navigating up, down, left, or right.",
  "Now navigate right by pressing the right arrow key, tapping the right side of the screen, or on the iPhone app, swiping right.",
].join(" ");

const TREE_LABEL = [
  "The entire app is structured as a left-to-right tree.",
  "Depending on your device you will navigate using the arrow keys, tapping the top, bottom, left, or right sides of the screen, or on the iPhone app, swiping up, down, left, or right.",
  "Navigate right to continue.",
].join(" ");

const BACK_PRACTICE_LABEL = [
  "To go to a previous screen, navigate left.",
  "Try it now, then return to this screen and navigate right.",
].join(" ");

const ITEM1_LABEL = "This is the first item in a list. Navigate down to explore the list.";
const ITEM2_LABEL = [
  "This is the second item in the list.",
  "If you are on the iPhone app, a longer swipe can scroll through multiple list items.",
  "Now navigate down again.",
].join(" ");
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
  "Enter text in the box, then use the tab key or your native screen gestures to find and click Cancel or Done.",
].join(" ");

export function openTutorial(
  deps: TutorialViewDeps,
  path: string,
  extras: RefreshExtras = {},
): RefreshResult {
  return viewFor(deps, tipForPath(path), extras);
}

export function refreshTutorial(
  deps: TutorialViewDeps,
  tipId: string | undefined,
  extras: RefreshExtras = {},
): RefreshResult {
  return viewFor(deps, tipId && isKnown(tipId) ? tipId : NODE.welcome, extras);
}

function viewFor(deps: TutorialViewDeps, tipId: string, extras: RefreshExtras): RefreshResult {
  const payloads = payloadsFor(extras.inputText);
  const tip = payloads.get(tipId) ?? payloads.get(NODE.welcome)!;
  return {
    navigationMap: tutorialMap(deps.rootAppId),
    warm: [...payloads.values()],
    node: tip,
    location: locationFor(tip.id),
  };
}

function payloadsFor(inputText: string | undefined): Map<string, NodePayload> {
  return new Map<string, NodePayload>([
    [NODE.welcome, { id: NODE.welcome, label: WELCOME_LABEL }],
    [NODE.tree, { id: NODE.tree, label: TREE_LABEL }],
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
    "This is the last screen of this tutorial.",
    "When you navigate right, you will reach the home screen.",
    "The home screen is a list of apps, including this tutorial app.",
    "Navigate up or down to access other apps.",
    'One more thing - to switch between recent apps without navigating back to the home screen, you can use the "r" key or double-tap the screen on the iPhone app.',
    "On input box screens, there is a Recent Apps button.",
    "Now navigate right to exit this tutorial.",
  ].join(" ");
}

function tutorialMap(rootAppId: string): NavigationMap {
  return buildMap(
    rootBackToHome(NODE.welcome, rootAppId, TUTORIAL_APP_ID),
    {
      [NODE.welcome]: {
        enter: edgeNode(NODE.tree, "push"),
      },
      [NODE.tree]: {
        enter: edgeNode(NODE.backPractice, "push"),
        back: edgePop(),
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
        enter: edgeToHome(rootAppId, TUTORIAL_APP_ID),
        back: edgePop(),
      },
    },
  );
}

function tipForPath(path: string): string {
  switch (path) {
    case "/tree":
      return NODE.tree;
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
    case NODE.tree:
      return { appId: TUTORIAL_APP_ID, path: "/tree" };
    case NODE.backPractice:
      return { appId: TUTORIAL_APP_ID, path: "/back" };
    case NODE.item1:
      return { appId: TUTORIAL_APP_ID, path: "/practice/1" };
    case NODE.item2:
      return { appId: TUTORIAL_APP_ID, path: "/practice/2" };
    case NODE.item3:
      return { appId: TUTORIAL_APP_ID, path: "/practice/3" };
    case NODE.item4:
      return { appId: TUTORIAL_APP_ID, path: "/practice/4" };
    case NODE.typePrompt:
      return { appId: TUTORIAL_APP_ID, path: "/type" };
    case NODE.input:
      return { appId: TUTORIAL_APP_ID, path: "/type/input" };
    case NODE.done:
      return { appId: TUTORIAL_APP_ID, path: "/done" };
    default:
      return { appId: TUTORIAL_APP_ID, path: "/" };
  }
}

function isKnown(tipId: string): boolean {
  return (
    tipId === NODE.welcome ||
    tipId === NODE.tree ||
    tipId === NODE.backPractice ||
    tipId === NODE.typePrompt ||
    tipId === NODE.input ||
    tipId === NODE.done ||
    (PRACTICE_IDS as readonly string[]).includes(tipId)
  );
}
