export const TUTORIAL_APP_ID = "tutorial";

/** Catalog label — Home shows this as the first item. */
export const TUTORIAL_APP_LABEL =
  "Tutorial app. To begin, press the right arrow key, tap the right of the screen, or on the iPhone app, swipe right. Navigate up or down to access other apps.";

export const NODE = {
  welcome: "tutorial:welcome",
  tree: "tutorial:tree",
  backPractice: "tutorial:back-practice",
  item1: "tutorial:item-1",
  item2: "tutorial:item-2",
  item3: "tutorial:item-3",
  item4: "tutorial:item-4",
  typePrompt: "tutorial:type-prompt",
  input: "tutorial:input",
  done: "tutorial:done",
} as const;

export const PRACTICE_IDS = [NODE.item1, NODE.item2, NODE.item3, NODE.item4] as const;
