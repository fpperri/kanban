# Testing

The plugin has no package dependencies (two libraries are vendored under `plugin/skills/web/web/vendor`, see `docs/web.md`); every test runs on Node 22 or later (the snapshot's also need Python 3.11 as `python`). Run these from the repo root.

The plugin ships from `plugin/` (the three skills and the icon); the tests live outside it, in `test/web/` and `test/snapshot/`, so an install carries none of them. `.claude-plugin/marketplace.json` stays at the repo root and points its one plugin at `./plugin`.

## The scripts

| Script | Runs | Use it |
| --- | --- | --- |
| `npm run test:unit` | every `test/web/*.test.js` except `launcher.test.js`, and every `test/snapshot/*.test.js` | while working; skips the launcher test |
| `npm run test:launcher` | `test/web/launcher.test.js` alone | at the desk only: it starts real servers on temp boards |
| `npm test` | all of the unit files, the launcher test included | what the `tests` workflow's unit job runs |
| `npm run test:browser` | the browser runner over every scenario | after a change to a page, a style or a scenario; needs Chrome, Edge or Chromium |
| `npm run test:ci` | what the workflow runs, in order: `npm test`, the browser runner forward and with `--reverse`, the older-plugin smoke run, `fault-check.js` | before calling a PR ready |

`test:ci` leaves out the `--shots` folders. Its older-plugin step serves boards with the server of a checkout of `main` in `./older`, as CI does; make one first with `git worktree add older origin/main` (it is not a tracked folder). After the push, `gh pr checks <n> --watch` waits for the real run.

The browser runner takes `--only <name>[,<name>]`, `--reverse`, `--list`, `--shots <dir>` and `--plugin <dir>`; the header of `test/web/browser/run.js` says what each does and what its exit codes mean. A forward run and a reversed one give the same results: that is how a scenario that leans on the one before it is found.

A local run slows the page's JavaScript 4 times (`Emulation.setCPUThrottlingRate`) and lengthens by the same factor every time limit a scenario can hit, because CI's runner is slower than a desk and a step that only passes on a fast page should fail here too. What scales: a scenario's timeout, `page.waitFor`, `page.waitUntil`, `page.sleep`, the wait for a refused request, a scenario's own loops through `page.scaled(ms)`, the pause that empties the tab history, the grace after a scenario, the wait for a board server, the DevTools call timeout and the watchdog on the whole run. What does not: the 20 s wait for Chrome to list a page, and the polling gaps inside a wait. A scenario never reads the clock with a literal: a wait loop of its own budgets with `page.scaled`. A run with the `CI` environment variable set (GitHub sets it) is not throttled. `KANBAN_BROWSER_CPU_THROTTLE=<rate>` sets the factor either way, and `KANBAN_BROWSER_CPU_THROTTLE=1` turns it off locally; `fault-check.js` pins it to 1, as it tests the runner's failure handling and not timing. The first line of a run and the last line of its summary say which factor it used. A step that fails only when throttled waits for the page's state, not for time.

Rough durations on a desktop: `test:unit` about two minutes, `test:launcher` under a minute, `test:browser` about two minutes (a reversed run the same), `test:ci` the sum of them. CI takes longer.

## Server tests

A test that needs the HTTP API starts the real server in-process: `createServer(dir)` from `plugin/skills/web/scripts/server.js`, listening on port 0 of `127.0.0.1`, on a board it writes into `os.tmpdir()` with `fs.mkdtempSync`. Each such file carries its own small `tmpBoard` and `withServer` helpers; `test/web/delete-server.test.js` is the model to copy. The server is closed when the callback returns, so a test leaves nothing running.

## Browser scenarios and fixture boards

Scenarios drive the real page in headless Chrome over the DevTools Protocol, each on a fixture board it names.

- A scenario is a file in `test/web/browser/scenarios/` that exports `{ name, board, alsoBoards?, timeoutMs?, run(page) }`; `smoke.js` is the smallest.
- Nothing registers it: `test/web/browser/scenarios/index.js` finds every `.js` file in the folder but itself, in file-name order, so the file's name is the scenario's `name`, and `test/web/browser-scenarios.test.js` holds the found set to the folder (every file found, unique names, name equal to file name, a known board). A module that is not a scenario goes in a subfolder. A scenario that checks a list the page owns (the gear's This board pages, the hotkeys) reads it from the page or its module rather than writing it out.
- A fixture board is a folder `test/web/browser/fixture-<name>/` holding the cards and `config.yaml` it adds to the layers below it. Register it in `BOARDS` in `test/web/browser/boards.js` as a list of layers, later folders replacing earlier files of the same name, and pin what is on it in `test/web/browser-fixtures.test.js`.
- A scenario that needs no browser to prove its wording, selectors or checks gets a `browser-<name>-scenario.test.js` beside the others; those run in `test:unit`.
- The `phone` and `phone-flip` scenarios are folders of steps. A step is a file in `test/web/browser/scenarios/phone-steps/` or `phone-flip-steps/` exporting `run(page)`; `test/web/browser/steps.js` runs them in name order, so a new step is one new file and touches no registry, no names test and no other step. Each starts from a clean page (about:blank, empty tab history, the scenario's boards' browser storage cleared, the start size, 390 by 844, with touch on for `phone`), reads the DOM and only the page globals `PAGE_GLOBALS` in `test/web/browser-globals.test.js` already lists, puts back any card it writes, and takes a few seconds at most (`phone` has 120 s for all its steps). `steps.js` also exports `tap`, `swipe` and `pinch`, which send `Input.dispatchTouchEvent` sequences.

## Docs and the tests that hold them

A doc gets a pinning test only for what a person, a tool or an agent copies, runs or parses: a command, a flag, a path, a file name or format, a port, a route or a payload shape. The test takes its expectation from the code, or runs the doc's own example through the real module; it never quotes a sentence. `test/web/hotkeys-coverage.test.js` is the model: the keys the page reads are found in its own source, and the list is held to them.

Prose about what the app does gets no docs test. The behaviour tests and the browser scenarios pin the behaviour, so changing a sentence of `docs/web.md`, of a web or snapshot `SKILL.md` or of `GLOSSARY.md` costs no test, and a behaviour with no test of its own is a gap to fill in the behaviour tests, not with a regex on a doc.

The docs tests, and what each holds to the code:

- `test/web/kanban-skill-contract.test.js`: the `config.yaml` examples of the kanban skill, the web skill and the README (read by `parseConfig`), the card fields, the card and notification examples, the forms of a parent, the starter against its file, and the commands against the scripts and flags they run.
- `test/web/notes-kit-contract.test.js`: the logbook, scratchpad, todo and group examples of the kanban skill, read by their stores, the file names the skill gives, and the placeholders `path-vars.js` fills.
- `test/web/doc-examples.test.js`: the search terms and the address the docs show, run through the search module.
- `test/snapshot/snapshot-contract.test.js`: the ops and `fm` shapes of `apply-protocol.md` against the payload the editor makes, and the web modules `docs/cross-harness.md` names against the generator's embed table.
- `test/web/doc-paths.test.js`: every repository path a doc names exists.
- `test/web/handles-in-skill-docs.test.js`: no `SKILL.md` carries a bare `@handle`, which the harness would read as an import.
- `test/web/docs-utf8.test.js`: every doc decodes as strict UTF-8.
- `test/web/testing-docs.test.js`: this file's scripts, flags, variables and paths.

The contract docs are the kanban skill's `SKILL.md` and the `references/*.md` beside it, the snapshot's `plugin/skills/snapshot/references/apply-protocol.md`, `docs/cross-harness.md` and the README's `config.yaml` and `Starter config` sections. The `tests` workflow's unit job checks out the whole history and, after `npm test`, runs `test/web/docs-pinned-check.js`. On a pull request the script reads `git diff --name-only <base>...HEAD`; if the change touches a contract doc and touches no docs test (`test/**/*-contract.test.js`, `test/**/*-docs.test.js`, `test/web/doc-examples.test.js` or `test/web/doc-paths.test.js`), the step fails and names the doc. For the README it reads the diff of the file and counts only the hunks that land in those two sections. On a push to `main` there is no pull request base and it does nothing.

For a change the tests cannot say anything about (a typo, a reworded sentence no test reads), a line in any commit message of the pull request lets it through:

```
Docs-test: none, <reason>
```

The reason is required and the line stands alone; the placeholder `<reason>` left as it is does not count. The script's decision is unit-tested with fixtures in `test/web/docs-pinned-check.test.js`; run it by hand with `node test/web/docs-pinned-check.js --base origin/main`.

## Snapshot tests

The snapshot editor is built by a Python script, `plugin/skills/snapshot/scripts/build_editor.py`. Its tests (`test/snapshot/`) run it in two ways: by reading the script as text and pulling out a marked block, or by running it with `execFileSync('python', [buildScript, board, '--out', file])` on a temp board and reading the HTML it wrote, which `page-harness.js` then loads in a vm. A `*-parity.test.js` file runs the same input through the Python and the web's JavaScript and compares the answers. Python's `__pycache__/` is ignored; do not commit it.
