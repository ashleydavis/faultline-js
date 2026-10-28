//
// The contexts a scenario and an expectation function are called with.
//
// Both offer `expect`. An expectation that does not hold is written down with the line it was made
// on, and the function stops there, as the user guide promises. Stopping a function part way
// through is done the one way JavaScript has: by throwing, here a value the run loop knows and
// never reports as a failure of the code under test.
//

import assert from "node:assert/strict";
import path from "node:path";
import type { IExpectationContext, IFaults, IProgramAnswer, IPrograms, IScenarioContext } from "../sim/index.ts";
import { withoutRun } from "../world/current.ts";
import type { RunSubject } from "../world/subject.ts";
import { locationOf, ownFrame } from "./judge.ts";

//
// What `expect` throws to stop the function that made an expectation that did not hold.
//
export class ExpectationStop extends Error {
    constructor(expectation: string) {
        super(`The expectation "${expectation}" did not hold.`);
        this.name = "ExpectationStop";
    }
}

//
// One expectation that did not hold.
//
export interface IExpectationRecord {
    //
    // The sentence the expectation was made with.
    //
    expectation: string;

    //
    // Where it was made, as `<file>:<line>` relative to the project root, or the empty string when
    // no line of the project made it.
    //
    location: string;
}

//
// The `expect` both contexts offer. It writes an expectation that does not hold into `records` and
// stops the function that made it.
//
export function expectInto(records: IExpectationRecord[], projectRoot: string): (condition: boolean, expectation: string) => void {
    assert(projectRoot.length > 0);
    return function expect(condition: boolean, expectation: string): void {
        if (condition) {
            return;
        }
        // Formatting the stack is the tool's work, so it reads the machine and is no place.
        const stack = withoutRun(() => `${new Error().stack}`);
        const frame = ownFrame(projectRoot, stack);
        records.push({
            expectation,
            location: frame === undefined ? "" : locationOf(projectRoot, frame),
        });
        throw new ExpectationStop(expectation);
    };
}

//
// The context an expectation function is called with.
//
export function createExpectationContext(records: IExpectationRecord[], projectRoot: string): IExpectationContext {
    return {
        expect: expectInto(records, projectRoot),
    };
}

//
// The context a scenario is called with, over the run `subject` it runs in. `load` imports a file
// of the project afresh, by its path relative to the project root.
//
export function createScenarioContext(
    subject: RunSubject,
    records: IExpectationRecord[],
    projectRoot: string,
    load: (path: string) => Promise<Record<string, unknown>>,
): IScenarioContext {
    const faults: IFaults = {
        get injected(): number {
            return subject.injector.injected ? 1 : 0;
        },
    };
    const programs: IPrograms = {
        answer(name: string, answer: IProgramAnswer): void {
            assert(name.length > 0, "A program is answered for by its name, and the name given was empty.");
            assert(Number.isInteger(answer.exitCode), `The exit code given for ${name} is not a whole number.`);
            subject.programs.set(name, {
                ...answer,
            });
        },
    };
    return {
        faults,
        programs,
        load,
        start: (file: string): Promise<Record<string, unknown>> => {
            assert(file.length > 0, "A file is started by its path, and the path given was empty.");
            subject.entryFile = path.join(projectRoot, file);
            return load(file);
        },
        expect: expectInto(records, projectRoot),
    };
}
