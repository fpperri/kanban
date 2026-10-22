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

A local run slows the page's JavaScript 4 times (`Emulation.setCPUThrottlingRate`) and lengthens by the same factor every time limit a scenario can hit, because CI's runner is slower than a desk and a step that only passes on a fast page should fail here too. What scales: a scenario's timeout, `page.waitFor`, `page.waitUntil`, `page.sleep`, the wait for a refused request, a scenario's own loops through `page.scaled(ms)`, the pause that empties the tab history, the grace after a scenario, the wait for a board server, the DevTools call timeout and the watchdog on the whole run. What does not: the 20 s wait for Chrome to list a page, and the polling gaps inside a wait. A scenario never reads the clock with a literal: a wait loop of its own budgets with `page.scaled`. A run with the `CI` environment variable set (GitHub sets it) is not throttled. `KANBAN_BROWSER_CPU_THROTTLE=<rate>` sets the factor either way, and `KANBAN_BROWSER_CPU_THROTTLE=1` turns it off locally; `fault-check.js` pins it to 1, as it tests the runner's failure handling and not timing. The first line of a run and the last line of its summary say which factor it used. A step that fails only when throttled waits for the page's state, not for time.

Rough durations on a desktop: `test:unit` about two minutes, `test:launcher` under a minute, `test:browser` about two minutes (a reversed run the same), `test:ci` the sum of them. CI takes longer.

## Server tests

A test that needs the HTTP API starts the real server in-process: `createServer(dir)` from `skills/web/scripts/server.js`, listening on port 0 of `127.0.0.1`, on a board it writes into `os.tmpdir()` with `fs.mkdtempSync`. Each such file carries its own small `tmpBoard` and `withServer` helpers; `skills/web/test/delete-server.test.js` is the model to copy. The server is closed when the callback returns, so a test leaves nothing running.

## Browser scenarios and fixture boards

Scenarios drive the real page in headless Chrome over the DevTools Protocol, each on a fixture board it names.

- A scenario is a file in `skills/web/test/browser/scenarios/` that exports `{ name, board, alsoBoards?, timeoutMs?, run(page) }`; `smoke.js` is the smallest.
- Nothing registers it: `skills/web/test/browser/scenarios/index.js` finds every `.js` file in the folder but itself, in file-name order, so the file's name is the scenario's `name`, and `skills/web/test/browser-scenarios.test.js` holds the found set to the folder (every file found, unique names, name equal to file name, a known board). A module that is not a scenario goes in a subfolder. A scenario that checks a list the page owns (the gear's This board pages, the hotkeys) reads it from the page or its module rather than writing it out.
- A fixture board is a folder `skills/web/test/browser/fixture-<name>/` holding the cards and `config.yaml` it adds to the layers below it. Register it in `BOARDS` in `skills/web/test/browser/boards.js` as a list of layers, later folders replacing earlier files of the same name, and pin what is on it in `skills/web/test/browser-fixtures.test.js`.
- A scenario that needs no browser to prove its wording, selectors or checks gets a `browser-<name>-scenario.test.js` beside the others; those run in `test:unit`.
- The `phone` and `phone-flip` scenarios are folders of steps. A step is a file in `skills/web/test/browser/scenarios/phone-steps/` or `phone-flip-steps/` exporting `run(page)`; `skills/web/test/browser/steps.js` runs them in name order, so a new step is one new file and touches no registry, no names test and no other step. Each starts from a clean page (about:blank, empty tab history, the scenario's boards' browser storage cleared, the start size, 390 by 844, with touch on for `phone`), reads the DOM and only the page globals `PAGE_GLOBALS` in `skills/web/test/browser-globals.test.js` already lists, puts back any card it writes, and takes a few seconds at most (`phone` has 120 s for all its steps). `steps.js` also exports `tap`, `swipe` and `pinch`, which send `Input.dispatchTouchEvent` sequences.

## Docs agree with code

Docs are held to the code by tests that read them as text. The pattern: a `*-docs.test.js` file reads `SKILL.md`, `docs/web.md`, `docs/snapshot.md`, `GLOSSARY.md` or the README, takes the section by its heading or its bold lead, and asserts the words the code makes true (and the words it made false are gone). `skills/web/test/docs-agree.test.js` and `skills/snapshot/test/docs-agree.test.js` pin the places where two docs once disagreed. A feature that changes behaviour a doc states changes the doc and its test in the same commit. `docs/testing.md` itself is pinned by `skills/web/test/testing-docs.test.js`.

## Snapshot tests

The snapshot editor is built by a Python script, `skills/snapshot/scripts/build_editor.py`. Its tests (`skills/snapshot/test/`) run it in two ways: by reading the script as text and pulling out a marked block, or by running it with `execFileSync('python', [buildScript, board, '--out', file])` on a temp board and reading the HTML it wrote, which `page-harness.js` then loads in a vm. A `*-parity.test.js` file runs the same input through the Python and the web's JavaScript and compares the answers. Python's `__pycache__/` is ignored; do not commit it.
