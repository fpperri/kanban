# Testing

The plugin has no package dependencies (two libraries are vendored under `skills/web/web/vendor`, see `docs/web.md`); every test runs on Node 22 or later (the snapshot's also need Python 3.11 as `python`). Run these from the repo root.

## The scripts

| Script | Runs | Use it |
| --- | --- | --- |
| `npm run test:unit` | every `skills/web/test/*.test.js` except `launcher.test.js`, and every `skills/snapshot/test/*.test.js` | while working; skips the launcher test |
| `npm run test:launcher` | `skills/web/test/launcher.test.js` alone | at the desk only: it starts real servers on temp boards |
| `npm test` | all of the unit files, the launcher test included | what the `tests` workflow's unit job runs |
| `npm run test:browser` | the browser runner over every scenario | after a change to a page, a style or a scenario; needs Chrome, Edge or Chromium |
| `npm run test:ci` | what the workflow runs, in order: `npm test`, the browser runner forward and with `--reverse`, the older-plugin smoke run, `fault-check.js` | before calling a PR ready |

`test:ci` leaves out the `--shots` folders. Its older-plugin step serves boards with the server of a checkout of `main` in `./older`, as CI does; make one first with `git worktree add older origin/main` (it is not a tracked folder). After the push, `gh pr checks <n> --watch` waits for the real run.

The browser runner takes `--only <name>[,<name>]`, `--reverse`, `--list`, `--shots <dir>` and `--plugin <dir>`; the header of `skills/web/test/browser/run.js` says what each does and what its exit codes mean. A forward run and a reversed one give the same results: that is how a scenario that leans on the one before it is found.

Rough durations on a desktop: `test:unit` about two minutes, `test:launcher` under a minute, `test:browser` about two minutes (a reversed run the same), `test:ci` the sum of them. CI takes longer.

## Server tests

A test that needs the HTTP API starts the real server in-process: `createServer(dir)` from `skills/web/scripts/server.js`, listening on port 0 of `127.0.0.1`, on a board it writes into `os.tmpdir()` with `fs.mkdtempSync`. Each such file carries its own small `tmpBoard` and `withServer` helpers; `skills/web/test/delete-server.test.js` is the model to copy. The server is closed when the callback returns, so a test leaves nothing running.

## Browser scenarios and fixture boards

Scenarios drive the real page in headless Chrome over the DevTools Protocol, each on a fixture board it names.

- A scenario is a file in `skills/web/test/browser/scenarios/` that exports `{ name, board, alsoBoards?, timeoutMs?, run(page) }`; `smoke.js` is the smallest.
- Register it in `skills/web/test/browser/scenarios/index.js`, then update the name list in `skills/web/test/browser-scenarios.test.js` (the test that pins the names and their order, and that every scenario names a known board).
- A fixture board is a folder `skills/web/test/browser/fixture-<name>/` holding the cards and `config.yaml` it adds to the layers below it. Register it in `BOARDS` in `skills/web/test/browser/boards.js` as a list of layers, later folders replacing earlier files of the same name, and pin what is on it in `skills/web/test/browser-fixtures.test.js`.
- A scenario that needs no browser to prove its wording, selectors or checks gets a `browser-<name>-scenario.test.js` beside the others; those run in `test:unit`.
- The `phone` and `phone-flip` scenarios are folders of steps. A step is a file in `skills/web/test/browser/scenarios/phone-steps/` or `phone-flip-steps/` exporting `run(page)`; `skills/web/test/browser/steps.js` runs them in name order, so a new step is one new file and touches no registry, no names test and no other step. Each starts from a clean page (about:blank, empty tab history, the scenario's boards' browser storage cleared, the start size, 390 by 844, with touch on for `phone`), reads the DOM and only the page globals `PAGE_GLOBALS` in `skills/web/test/browser-globals.test.js` already lists, puts back any card it writes, and takes a few seconds at most (`phone` has 120 s for all its steps). `steps.js` also exports `tap`, `swipe` and `pinch`, which send `Input.dispatchTouchEvent` sequences.

## Docs agree with code

Docs are held to the code by tests that read them as text. The pattern: a `*-docs.test.js` file reads `SKILL.md`, `docs/web.md`, `docs/snapshot.md`, `GLOSSARY.md` or the README, takes the section by its heading or its bold lead, and asserts the words the code makes true (and the words it made false are gone). `skills/web/test/docs-agree.test.js` and `skills/snapshot/test/docs-agree.test.js` pin the places where two docs once disagreed. A feature that changes behaviour a doc states changes the doc and its test in the same commit. `docs/testing.md` itself is pinned by `skills/web/test/testing-docs.test.js`.

## A docs change brings its docs test

The rule above is held by the `tests` workflow. Its unit job checks out the whole history and, after `npm test`, runs `skills/web/test/docs-pinned-check.js`. On a pull request the script reads `git diff --name-only <base>...HEAD`; if the change touches `docs/*.md`, any `SKILL.md` or `README.md` and touches no `skills/**/test/*-docs.test.js` and no `docs-agree.test.js`, the step fails and names the doc that changed. On a push to `main` there is no pull request base and it does nothing.

For a change the tests cannot say anything about (a typo, a reworded sentence no test reads), a line in any commit message of the pull request lets it through:

```
Docs-test: none, <reason>
```

The reason is required and the line stands alone. The script's decision is unit-tested with fixtures in `skills/web/test/docs-pinned-check.test.js`; run it by hand with `node skills/web/test/docs-pinned-check.js --base origin/main`.

## Snapshot tests

The snapshot editor is built by a Python script, `skills/snapshot/scripts/build_editor.py`. Its tests (`skills/snapshot/test/`) run it in two ways: by reading the script as text and pulling out a marked block, or by running it with `execFileSync('python', [buildScript, board, '--out', file])` on a temp board and reading the HTML it wrote, which `page-harness.js` then loads in a vm. A `*-parity.test.js` file runs the same input through the Python and the web's JavaScript and compares the answers. Python's `__pycache__/` is ignored; do not commit it.
