import type { BibleSeed } from "./types.ts";

/** Tiny corpus when Bible opens `:memory:` without an explicit test seed. */
export const MEMORY_SEED: BibleSeed = {
  verses: [
    {
      versionId: "kjv",
      bookId: "GEN",
      chapter: 1,
      verse: 1,
      text: "In the beginning God created the heaven and the earth.",
    },
  ],
};
