export const HELP_APP_ID = "help";

/** Catalog label — Home shows this as the first item. */
export const HELP_APP_LABEL =
  "Help. Tap the right side of the screen or press the right arrow to enter.";

export const NODE = {
  welcome: "help:welcome",
  backPractice: "help:back-practice",
  item1: "help:item-1",
  item2: "help:item-2",
  item3: "help:item-3",
  item4: "help:item-4",
  typePrompt: "help:type-prompt",
  input: "help:input",
  done: "help:done",
} as const;

export const PRACTICE_IDS = [NODE.item1, NODE.item2, NODE.item3, NODE.item4] as const;
