import type { KjvData } from "../../src/apps/bible/types.ts";

/** Tiny KJV subset for unit tests — Genesis 1:1–3 and Matthew 5:1–3. */
export const fixtureKjv: KjvData = {
  translation: "KJV",
  books: [
    {
      name: "Genesis",
      abbrev: "gn",
      testament: "OT",
      chapters: [
        [
          "In the beginning God created the heaven and the earth.",
          "And the earth was without form, and void.",
          "And God said, Let there be light: and there was light.",
        ],
      ],
    },
    {
      name: "Matthew",
      abbrev: "mt",
      testament: "NT",
      chapters: [
        ["Placeholder Matthew 1:1"],
        ["Placeholder Matthew 2:1"],
        ["Placeholder Matthew 3:1"],
        ["Placeholder Matthew 4:1"],
        [
          "And seeing the multitudes, he went up into a mountain.",
          "And he opened his mouth, and taught them, saying,",
          "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
        ],
      ],
    },
  ],
};
