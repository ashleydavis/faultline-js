// Runs the copies in a real browser, and reads what V8 counted there.
//
// Browser code reaches for a document, a window and the rest, and a page is where those are. The
// coverage that comes back is the same V8 reports in Node, so everything past this point is shared.

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { addInto, type ScriptCoverage } from "../coverage/v8.ts";
import { Copies, countsIn, didRun } from "../report/tally.ts";
import type { RunModel } from "../model.ts";
import { askedFromPage, type FromDriver, type Unit } from "./protocol.ts";

// Where the tool's own driver is put inside the work directory, so the page can load it.
export const driverDirectory = "__faultline";

// What the page loads to start the run.
export const pageDriver = `${driverDirectory}/drive/page.mjs`;

// What a browser run came back with.
export interface BrowserResult {
    // Everything the page said, in order.
    said: FromDriver[];

    // What V8 counted in the page.
    scripts: ScriptCoverage[];

    // What stopped the run before it started, when something did.
    broke?: string;
}

// The media types the server hands back, by extension. A module served as anything but JavaScript
// is refused by the browser before it runs.
const types: Record<string, string> = {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".json": "application/json",
    ".html": "text/html",
    ".css": "text/css",
    ".map": "application/json",
};

// The little of Playwright this uses, written out so the tool builds without it installed.
//
// Every wall clock limit is turned off. A run replaces the timers underneath the code it is
// measuring, so a limit of any length at all goes off at once while a run is driving this file, and
// a limit is not what says whether a page got anywhere.
interface Chromium {
    launch: (options: { executablePath?: string; timeout?: number }) => Promise<{
        newPage: () => Promise<Page>;
        close: () => Promise<void>;
    }>;
}

// The little of a page this uses.
interface Page {
    context: () => { newCDPSession: (page: Page) => Promise<Session> };
    setDefaultTimeout: (after: number) => void;
    setDefaultNavigationTimeout: (after: number) => void;
    exposeFunction: (name: string, work: (...args: never[]) => unknown) => Promise<void>;
    route: (pattern: string, answer: (route: Route) => Promise<void> | void) => Promise<void>;
    goto: (url: string) => Promise<unknown>;
    evaluate: <T>(body: string) => Promise<T>;
}

// The little of one intercepted request this uses. The page asks for the copies by the paths the
// model names, and each request is answered here rather than over a socket.
interface Route {
    request: () => { url: () => string };
    fulfill: (answer: { status: number; contentType?: string; body?: Buffer | string }) => Promise<void>;
}

// The little of a debugging session this uses. It is what lets the run read what V8 has counted
// while the page is still running, which `page.coverage` only reports once it is stopped.
interface Session {
    send: (method: string, params?: Record<string, unknown>) => Promise<{ result?: ScriptCoverage[] }>;
    detach: () => Promise<void>;
}


// Puts the tool's own driver into the work directory, as modules a browser can load.
//
// The driver is the tool's own TypeScript, so it is transpiled the same way the code under test is
// and its imports are pointed at the copies beside it.
export function emitDriver(work: string, options: ts.CompilerOptions): void {
    const from = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
    const done = new Set<string>();

    // A clone runs the tool's own TypeScript and an installed copy runs what the build emitted, so
    // the driver is found under whichever extension is there.
    const entry = [path.join(from, "drive", "page.ts"), path.join(from, "drive", "page.js")].find((one) =>
        fs.existsSync(one),
    );
    if (entry === undefined) {
        throw new Error("The page driver was not found beside the tool. Run `npm run build` in a clone of it.");
    }

    // Follows one file's imports and writes every one of them out.
    function carry(file: string): void {
        if (done.has(file)) {
            return;
        }
        done.add(file);
        const text = fs.readFileSync(file, "utf8");
        const js = ts.transpileModule(text, {
            fileName: file,
            compilerOptions: { ...options, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: false, inlineSourceMap: false, noEmit: false },
        }).outputText;
        const target = path.join(work, driverDirectory, path.relative(from, file).replace(/\.[jt]s$/, ".mjs"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        // Every import inside the tool names a file beside it, and what sits beside it in the work
        // directory is the copy.
        fs.writeFileSync(target, js.replace(/(["'])(\.[^"']*?)\.[jt]s\1/g, "$1$2.mjs$1"));
        for (const spec of [...js.matchAll(/from\s+["'](\.[^"']+\.[jt]s)["']/g)].map((one) => one[1]!)) {
            carry(path.resolve(path.dirname(file), spec));
        }
    }

    carry(entry);
}

// What one request is answered with.
//
// It is worked out apart from the serving, because what to answer is a question about a path and
// the serving is a socket. A scenario can ask the question; nothing can ask a socket.
export interface Answer {
    // The status the answer carries.
    status: number;

    // What kind of thing the body is, when there is a body.
    type?: string;

    // The body itself, when there is one.
    body?: Buffer | string;
}

// What the work directory answers one path with.
export function serveOne(work: string, url: string | undefined): Answer {
    const asked = decodeURIComponent((url ?? "/").split("?")[0]!);
    if (asked === "/") {
        return { status: 200, type: "text/html", body: "<!doctype html><html><head><title>faultline</title></head><body></body></html>" };
    }
    const full = path.join(work, asked);
    if (!full.startsWith(work)) {
        // A path that climbs out of the work directory is refused rather than served.
        return { status: 403 };
    }
    try {
        return { status: 200, type: types[path.extname(full)] ?? "application/octet-stream", body: fs.readFileSync(full) };
    }
    catch {
        return { status: 404 };
    }
}

// Where the page thinks it came from.
//
// No socket is opened and no name is looked up: every request the page makes is answered inside
// this process, and this is only the address the page reads its own paths against. `.invalid` is
// the name reserved for a name that resolves to nothing, so a request that somehow escaped would
// reach no machine.
const pageOrigin = "http://faultline.invalid";

// Answers every request the page makes out of the work directory.
//
// The copies used to be served over a socket on the loopback address. Answering inside the process
// needs no port, no server and no shutting down, and it is what lets a run measuring this file
// drive a page at all: a run replaces the module that opens a socket, so a server started under one
// listens nowhere.
async function answerWith(page: Page, work: string): Promise<void> {
    await page.route("**/*", async (route) => {
        const answer = serveOne(work, new URL(route.request().url()).pathname);
        await route.fulfill({ status: answer.status, contentType: answer.type, body: answer.body });
    });
}

// The package a browser is driven through.
export const browserPackage = "playwright";

// Loads the package that drives a browser, or hands back nothing when the project has none.
//
// Which package is a parameter so that a run can drive both sides of it: a machine with the package
// installed reaches the loading, and a name no machine has reaches what is said about a machine
// without it. It is never passed anything but the name above by the tool itself.
async function chromiumFrom(named: string): Promise<Chromium | undefined> {
    try {
        // Named through a variable so the compiler does not look for a package a project running
        // only in Node has no reason to install.
        const loaded = (await import(named)) as unknown as { chromium: Chromium };
        return loaded.chromium;
    }
    catch {
        return undefined;
    }
}

// Drives one list of work in a browser.
export async function driveInBrowser(
    model: RunModel,
    units: Unit[],
    ticked: string[],
    executablePath: string | undefined,
    named = browserPackage,
): Promise<BrowserResult> {
    const chromium = await chromiumFrom(named);
    if (chromium === undefined) {
        return {
            said: [],
            scripts: [],
            broke: "Running in a browser needs Playwright. Install it with `npm install --save-dev playwright`, then its browser with `npx playwright install chromium`.",
        };
    }

    // A machine that keeps its browsers somewhere of its own says so here, which is what a
    // container with one already installed does.
    const wanted = executablePath ?? process.env.FAULTLINE_CHROMIUM;

    let browser;
    try {
        // Playwright throws an Error and throws nothing else, so its message is what there is to
        // print.
        browser = await chromium.launch(wanted === undefined ? { timeout: 0 } : { executablePath: wanted, timeout: 0 });
    }
    catch (thrown) {
        return {
            said: [],
            scripts: [],
            broke: `The browser would not start: ${(thrown as Error).message}`,
        };
    }
    try {
        const page = await browser.newPage();
        // Playwright gives up on a page that takes longer than its own wall clock allows. A run
        // decides how long its own work takes, and the one call that does the driving has no such
        // limit to begin with, so the rest are turned off and the run waits for the page as long as
        // the page takes.
        page.setDefaultTimeout(0);
        page.setDefaultNavigationTimeout(0);
        const watcher = await page.context().newCDPSession(page);
        await watcher.send("Profiler.enable");
        // The same counting the Node side starts: a count per block rather than a yes or no per
        // function, because a block is what a code path is read from.
        await watcher.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

        // Everything the page has counted, added up across every reading. Taking coverage resets
        // V8's counters, so a reading is what has run since the last one.
        const counted = new Map<string, ScriptCoverage>();
        const cameFrom = `${pageOrigin}/`;

        // Reads what the page has counted since the last reading and adds it to the total. The page
        // loaded the copies over a server, so V8 names them by the address they came from, and
        // everything past here knows them by where they sit on disk.
        async function take(): Promise<void> {
            // Reading the counters always carries a result. The other calls this makes carry none,
            // which is why the one type covering them all says it may be missing.
            const answer = (await watcher.send("Profiler.takePreciseCoverage")).result!;
            addInto(
                counted,
                answer
                    .filter((script) => script.url.startsWith(cameFrom) && !script.url.includes(driverDirectory))
                    .map((script) => ({
                        ...script,
                        url: pathToFileURL(path.join(model.work, script.url.slice(cameFrom.length))).href,
                    })),
            );
        }

        const copies = new Copies(model);
        await page.exposeFunction(askedFromPage, async (file: string): Promise<string[]> => {
            await take();
            const counts = countsIn(copies, new Map([[0, counted]]));
            const held = model.files.find((one) => one.file === file);
            return (held?.paths ?? []).filter((site) => didRun(site, counts)).map((site) => site.name);
        });

        await answerWith(page, model.work);
        await page.goto(`${pageOrigin}/`);

        // The page fetches the run and the work rather than being handed them, so nothing large
        // crosses as an argument.
        const said = await page.evaluate<FromDriver[]>(`(async () => {
            const driver = await import(${JSON.stringify(`/${pageDriver}`)});
            const model = await (await fetch("/model.json")).json();
            const units = ${JSON.stringify(units)};
            const ticked = ${JSON.stringify(ticked)};
            return await driver.driveInPage(model, units, ticked);
        })()`);

        await take();
        await watcher.detach();
        return { said, scripts: [...counted.values()] };
    }
    catch (thrown) {
        return {
            said: [],
            scripts: [],
            broke: `The run in the browser stopped: ${(thrown as Error).message}`,
        };
    }
    finally {
        await browser.close();
    }
}
