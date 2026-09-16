// Runs the copies in a real browser, and reads what V8 counted there.
//
// Browser code reaches for a document, a window and the rest, and a page is where those are. The
// coverage that comes back is the same V8 reports in Node, so everything past this point is shared.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import type { ScriptCoverage } from "../coverage/v8.ts";
import type { RunModel } from "../model.ts";
import type { FromDriver, Unit } from "./protocol.ts";

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
interface Chromium {
    launch: (options: { executablePath?: string }) => Promise<{
        newPage: () => Promise<Page>;
        close: () => Promise<void>;
    }>;
}

// The little of a page this uses.
interface Page {
    coverage: {
        startJSCoverage: (options: { reportAnonymousScripts: boolean }) => Promise<void>;
        stopJSCoverage: () => Promise<unknown[]>;
    };
    goto: (url: string) => Promise<unknown>;
    evaluate: <T>(body: string) => Promise<T>;
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

// Serves the work directory, so the page loads the copies by the paths the model names.
export function serve(work: string): Promise<{ port: number; close: () => void }> {
    const server = http.createServer((request, response) => {
        const asked = decodeURIComponent((request.url ?? "/").split("?")[0]!);
        if (asked === "/") {
            response.writeHead(200, { "content-type": "text/html" });
            response.end("<!doctype html><html><head><title>faultline</title></head><body></body></html>");
            return;
        }
        const full = path.join(work, asked);
        if (!full.startsWith(work)) {
            // A path that climbs out of the work directory is refused rather than served.
            response.writeHead(403);
            response.end();
            return;
        }
        try {
            const body = fs.readFileSync(full);
            response.writeHead(200, { "content-type": types[path.extname(full)] ?? "application/octet-stream" });
            response.end(body);
        }
        catch {
            response.writeHead(404);
            response.end();
        }
    });
    return new Promise((settle) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            settle({ port, close: () => server.close() });
        });
    });
}

// Loads Playwright, or says what to install when the project has none.
async function chromiumFrom(): Promise<Chromium | undefined> {
    try {
        // Named through a variable so the compiler does not look for a package a project running
        // only in Node has no reason to install.
        const named = "playwright";
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
): Promise<BrowserResult> {
    const chromium = await chromiumFrom();
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

    const served = await serve(model.work);
    let browser;
    try {
        browser = await chromium.launch(wanted === undefined ? {} : { executablePath: wanted });
    }
    catch (thrown) {
        served.close();
        return {
            said: [],
            scripts: [],
            broke: `The browser would not start: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        };
    }
    try {
        const page = await browser.newPage();
        await page.coverage.startJSCoverage({ reportAnonymousScripts: false });
        await page.goto(`http://127.0.0.1:${served.port}/`);

        // The page fetches the run and the work rather than being handed them, so nothing large
        // crosses as an argument.
        const said = await page.evaluate<FromDriver[]>(`(async () => {
            const driver = await import(${JSON.stringify(`/${pageDriver}`)});
            const model = await (await fetch("/model.json")).json();
            const units = ${JSON.stringify(units)};
            const ticked = ${JSON.stringify(ticked)};
            return await driver.driveInPage(model, units, ticked);
        })()`);

        const taken = (await page.coverage.stopJSCoverage()) as unknown as ScriptCoverage[];
        // The page loaded the copies over a server, so V8 names them by the address they came from.
        // Everything past here knows them by where they sit on disk.
        const served_at = `http://127.0.0.1:${served.port}/`;
        const scripts = taken
            .filter((script) => script.url.startsWith(served_at) && !script.url.includes(driverDirectory))
            .map((script) => ({
                ...script,
                url: pathToFileURL(path.join(model.work, script.url.slice(served_at.length))).href,
            }));
        return { said, scripts };
    }
    catch (thrown) {
        return {
            said: [],
            scripts: [],
            broke: `The run in the browser stopped: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
        };
    }
    finally {
        await browser.close();
        served.close();
    }
}
