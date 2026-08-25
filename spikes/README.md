# Spikes

These are throwaway probes used to answer a question before committing to a design. **Nothing here is application code**, and nothing here should be imported by the real app.

The product outcomes below are **settled**. The HTML files remain so a human can re-run a probe; they are not open questions for agents. Do not treat this folder as a backlog.

---

## `screen-reader-probe.html` — do arrow keys survive a screen reader?

### Why this existed

Nowisee shows one piece of text at a time and expects the arrow keys to move you between pieces. That only works if two things are true:

1. When a screen reader is running, the arrow keys actually reach the web page.
2. When the page's text changes, the screen reader reads the new text.

Neither is guaranteed. NVDA and JAWS normally run web pages in a mode where the arrow keys belong to the screen reader, not to the page. VoiceOver on a Mac does the same when Quick Nav is on. On a phone there are no arrow keys at all.

### Outcome (settled)

The product uses:

- `role="application"` on the text surface so arrow keys reach the page.
- Focus announcement for content changes (no `aria-live` on that surface).
- Cancel / Done on input tips (plain arrows stay with the caret; no Escape exit).
- Invisible VoiceOver edge pads (right=enter, left=back, top=prev, bottom=next).

See [`docs/MODULES.md`](../docs/MODULES.md) (Display, Keyboard) and [`docs/PREPAREDNESS.md`](../docs/PREPAREDNESS.md).

### How to re-run it

Open `screen-reader-probe.html` in a browser. Double-clicking the file works; no server, no install, no internet.

The page explains itself from there. In short: turn on a screen reader, pick one of six setups, press the button that puts you in the reading area, press the arrow keys, and see whether anything happens. The page automatically detects whether your key presses arrived and says so in plain words. Then you answer four short questions about what you actually heard. Repeat for each setup, then copy the summary box at the bottom.

Combinations that matter most if you re-test:

| Screen reader | Browser | Why it matters |
|---------------|---------|----------------|
| NVDA | Firefox | The most common free combination |
| NVDA | Chrome | Behaves differently from Firefox often enough to matter |
| JAWS | Chrome | The most common paid combination |
| VoiceOver | Safari on a Mac | Try it both with Quick Nav on and off |
| VoiceOver | Safari on an iPhone | No arrow keys exist; tells us what a phone version has to look like |
| TalkBack | Chrome on Android | Same question for Android |

### What each setup is

| Setup | Arrangement | What we learn |
|-------|-------------|---------------|
| A | Text in a focusable `div`, `aria-live="polite"` | The gentle default. Do keys arrive, and is one announcement per change enough? |
| B | Same, `aria-live="assertive"` | Does interrupting cause double-speaking or cut-off text when moving quickly? |
| C | `role="application"` around the text | Usually forces the keys through, but often disables the screen reader's own reading commands. |
| D | Focus moved back onto the text after each change, no live region | Does relying on ordinary focus announcements sound better than a live region? |
| E | Text inside a read-only text box | Text boxes normally get the keys handed to them. |
| F | A real editable text box | For typing screens: do plain arrows still move the caret, and do `Enter` and `Alt`+`Up` reach the page? |

The page prints GOOD / PARTLY / BLOCKED per setup for whether keys arrived. Hearing quality is a human judgment.

---

## `voiceover-dom-focus-probe.html` — does VoiceOver accessibility focus become DOM focus?

### Why this existed

On iPhone there is no keyboard. One candidate for phone navigation is large edge pads: when VoiceOver’s accessibility focus lands on a pad, navigate — without requiring a second double-tap to activate.

That only works if VoiceOver’s accessibility focus also fires a real DOM `focus` / `focusin` event.

### Outcome (settled)

Desktop VoiceOver edge pads already ship (focus or click). A native iPhone client is still deferred — see [`docs/PREPAREDNESS.md`](../docs/PREPAREDNESS.md) for the Display port and mapping swipe or direct-touch to the same four intents. This probe remains evidence for that later slice.

### How to re-run it

On an iPhone, open the GitHub Pages copy in Safari:

**https://pmcculfor.github.io/nowisee/spikes/voiceover-dom-focus-probe.html**

(The same file also lives at `spikes/voiceover-dom-focus-probe.html` and is copied into `public/spikes/` so the Pages build ships it.)

1. Turn VoiceOver on.
2. Explore by touch (drag a finger) or swipe right/left across the probes.
3. Do **not** double-tap — the question is focus-only.
4. The sticky status box at the top turns green and announces whenever a real DOM `focusin` fires.
5. Copy the summary if you are gathering evidence for a native/phone slice.
