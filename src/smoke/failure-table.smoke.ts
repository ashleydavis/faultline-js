//
// Checks that the failure table in code is the table in `docs/FAILURES.md`.
//
// The document is read and split into its headings and the rows under each. Every group in code
// must have its heading, in the same order, and its rows must match the document's row for row, in
// both columns, so a row cannot be added to one and left out of the other.
//

import assert from "node:assert/strict";
import path from "node:path";
import { FileSystem } from "../lib/file-system.ts";
import { failureGroups } from "../world/failures.ts";

//
// One row of the document's table: the two cells.
//
export interface IDocumentRow {
    //
    // The "Failure" cell.
    //
    description: string;

    //
    // The "What the call does" cell.
    //
    outcome: string;
}

//
// The document's tables, by heading, in the order the document has them. A heading with no table
// under it is left out.
//
export function documentTables(text: string): Map<string, IDocumentRow[]> {
    assert(text.length > 0, "docs/FAILURES.md is empty.");
    const tables = new Map<string, IDocumentRow[]>();
    let heading = "";
    for (const line of text.split("\n")) {
        if (line.startsWith("## ")) {
            heading = line.slice(3);
            continue;
        }
        if (!isTableRow(line)) {
            continue;
        }
        const cells = line.slice(2, -2).split(" | ");
        assert.equal(cells.length, 2, `A row under "${heading}" has other than two cells: ${line}`);
        const rows = tables.get(heading) ?? [];
        rows.push({
            description: cells[0],
            outcome: cells[1],
        });
        tables.set(heading, rows);
    }
    assert(!tables.has(""), "docs/FAILURES.md has a table above its first heading.");
    return tables;
}

//
// Whether a line of the document is a row of failures, rather than prose, the header row or the
// line under the header.
//
export function isTableRow(line: string): boolean {
    assert(!line.includes("\n"));
    if (!line.startsWith("| ")) {
        return false;
    }
    if (line.startsWith("| Failure |")) {
        return false;
    }
    return !line.startsWith("| ---");
}

//
// Reads the document and compares it with the groups in code.
//
export async function main(): Promise<void> {
    const document = path.resolve(import.meta.dirname, "../../docs/FAILURES.md");
    const tables = documentTables(await new FileSystem().readText(document));
    assert.deepEqual([...tables.keys()], failureGroups.map((group) => group.heading));
    for (const group of failureGroups) {
        assert.deepEqual(tables.get(group.heading), group.kinds.map((kind) => ({
            description: kind.description,
            outcome: kind.outcome,
        })), `The rows under "${group.heading}" differ between docs/FAILURES.md and the code.`);
    }
    process.stdout.write("The failure table in code is the table in docs/FAILURES.md.\n");
}

await main();
