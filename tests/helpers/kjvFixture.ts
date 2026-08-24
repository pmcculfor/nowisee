import type { BibleSeed } from "../../src/apps/bible/types.ts";

/** Tiny corpus for unit tests. Never a full translation. */
export const fixtureBible: BibleSeed = {
  verses: [
    ...kjvGenesis1(),
    ...kjvMatthew(),
    ...asvGenesis1(),
    ...asvMatthew(),
  ],
  sections: [
    {
      commentaryId: "henry",
      bookId: "MAT",
      startChapter: 5,
      startVerse: 1,
      endChapter: 5,
      endVerse: 8,
      body: "Henry on the Beatitudes, covering verses 1 through 8.",
    },
    {
      commentaryId: "tsk",
      bookId: "MAT",
      startChapter: 5,
      startVerse: 3,
      endChapter: 5,
      endVerse: 3,
      body: "poor: isa 66:2; mt 11:5",
      xrefs: ["isa 66:2; mt 11:5"],
    },
  ],
};

/** @deprecated Use fixtureBible. Kept as an alias for host tests mid-rename. */
export const fixtureKjv = fixtureBible;

function kjvGenesis1() {
  return verses("kjv", "GEN", 1, [
    "In the beginning God created the heaven and the earth.",
    "And the earth was without form, and void.",
    "And God said, Let there be light: and there was light.",
  ]);
}

function kjvMatthew() {
  return [
    ...verses("kjv", "MAT", 1, ["Placeholder Matthew 1:1"]),
    ...verses("kjv", "MAT", 2, ["Placeholder Matthew 2:1"]),
    ...verses("kjv", "MAT", 3, ["Placeholder Matthew 3:1"]),
    ...verses("kjv", "MAT", 4, ["Placeholder Matthew 4:1"]),
    ...verses("kjv", "MAT", 5, [
      "And seeing the multitudes, he went up into a mountain.",
      "And he opened his mouth, and taught them, saying,",
      "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
      "Blessed are they that mourn: for they shall be comforted.",
      "Blessed are the meek: for they shall inherit the earth.",
      "Blessed are they which do hunger and thirst after righteousness.",
      "Blessed are the merciful: for they shall obtain mercy.",
      "Blessed are the pure in heart: for they shall see God.",
    ]),
  ];
}

function asvGenesis1() {
  return verses("asv", "GEN", 1, [
    "In the beginning God created the heavens and the earth.",
  ]);
}

function asvMatthew() {
  return verses("asv", "MAT", 5, [
    "And seeing the multitudes, he went up into the mountain.",
    "And he opened his mouth and taught them, saying,",
    "Blessed are the poor in spirit: for theirs is the kingdom of heaven.",
    "Blessed are they that mourn: for they shall be comforted.",
    "Blessed are the meek: for they shall inherit the earth.",
    "Blessed are they that hunger and thirst after righteousness.",
    "Blessed are the merciful: for they shall obtain mercy.",
  ]);
}

function verses(versionId: string, bookId: string, chapter: number, lines: readonly string[]) {
  return lines.map((text, index) => ({
    versionId,
    bookId,
    chapter,
    verse: index + 1,
    text,
  }));
}
