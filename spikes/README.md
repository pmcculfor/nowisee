# Spikes

Throwaway probes used to answer a question before committing to a design. **Nothing here is application code** and nothing here should be imported by the real app.

---

## `screen-reader-probe.html` — do arrow keys survive a screen reader?

### Why this exists

Nowisee shows one piece of text at a time and expects the arrow keys to move you between pieces. That only works if two things are true:

1. When a screen reader is running, the arrow keys actually reach the web page.
2. When the page's text changes, the screen reader reads the new text.

Neither is guaranteed. NVDA and JAWS normally run web pages in a mode where the arrow keys belong to the screen reader, not to the page — they move the screen reader's own cursor through the page's content, and the page never finds out you pressed anything. VoiceOver on a Mac does the same when its Quick Nav feature is on. On a phone there are no arrow keys at all.

There are known ways around this, and each one costs something. This page tries six of them side by side so we can pick based on evidence instead of guessing. It is the one open question that could invalidate the product rather than just cost a rewrite, and it needs no decisions from anywhere else in the project — so it can be run at any time, by anyone with a screen reader.

### How to run it

Open `screen-reader-probe.html` in a browser. Double-clicking the file works; no server, no install, no internet.

The page explains itself from there. In short: turn on a screen reader, pick one of six setups, press the button that puts you in the reading area, press the arrow keys, and see whether anything happens. The page automatically detects whether your key presses arrived and says so in plain words. Then you answer four short questions about what you actually heard, because no program can detect that. Repeat for each setup, then copy the summary box at the bottom.

Please run it once per combination you can manage. The ones that matter most:

| Screen reader | Browser | Why it matters |
|---------------|---------|----------------|
| NVDA | Firefox | The most common free combination |
| NVDA | Chrome | Behaves differently from Firefox often enough to matter |
| JAWS | Chrome | The most common paid combination |
| VoiceOver | Safari on a Mac | Try it both with Quick Nav on and off |
| VoiceOver | Safari on an iPhone | No arrow keys exist; tells us what a phone version has to look like |
| TalkBack | Chrome on Android | Same question for Android |

Testing even one of these is worth more than testing none.

### What each setup is

The page describes these in plain language as you go. For the record, in technical terms:

| Setup | Arrangement | What we learn |
|-------|-------------|---------------|
| A | Text in a focusable `div`, `aria-live="polite"` | The gentle default. Do keys arrive, and is one announcement per change enough? |
| B | Same, `aria-live="assertive"` | Does interrupting cause double-speaking or cut-off text when moving quickly? |
| C | `role="application"` around the text | Usually forces the keys through, but often disables the screen reader's own reading commands. Is that trade acceptable? |
| D | Focus moved back onto the text after each change, no live region | Does relying on ordinary focus announcements sound better than a live region? |
| E | Text inside a read-only text box | Text boxes normally get the keys handed to them. Does that fix A–D's problem, and is a text box a tolerable thing to read from? |
| F | A real editable text box | For Nowisee's typing screens: do plain arrows still move the cursor through letters, and do `Enter` and `Alt`+`Up` reach the page? |

### How to read the results

The page prints one of three verdicts per setup, automatically:

- **GOOD** — arrow keys reached the reading area. The setup is technically viable; the remaining question is how it sounds.
- **PARTLY** — keys reached the page but not the reading area. Your focus was somewhere else. Press the focus button and try again.
- **BLOCKED** — nothing arrived. The screen reader kept the keys. That setup cannot work as-is.

Your answers to the four questions decide between the setups that pass. In rough order of importance: did you hear the new text every time; was it clean rather than double-spoken or cut off; could you still use your screen reader's own reading commands; would it be pleasant for an hour.

### What the answers decide

- **If at least one of A–E is GOOD and sounds clean:** that becomes the arrangement for the single text surface, and it gets written into `docs/MODULES.md` §8 (Display) and §9 (Keyboard) as a lock. The choice between polite and assertive announcements — currently an open item — is settled by the same run.
- **If only C (application role) works:** we take it, and we accept that Nowisee has to provide its own way to re-read and move through long text, because the screen reader's reading commands will be unavailable. That is a real product decision and it would need to be made deliberately.
- **If everything is BLOCKED everywhere:** arrow-key navigation is not achievable in a browser for those users, and the input model has to change — most likely to keys screen readers do not intercept, or to a different interaction shape entirely. Better to know now.
- **Setup F separately** confirms the default typing-screen keys in `docs/MODULES.md` §9. If `Alt`+`Up` does not arrive, or if plain arrows stop moving the cursor, that table changes. Because apps only ever see intents like `enter` and `back`, changing it affects one file and no app.

Whatever comes back, record it in `docs/DESIGN-REVIEW.md` §7 and turn the outcome into a lock.
