// The functions Faultline passes to the code under test, as an argument or as a property of one.
//
// Each call of such a function is a place where the failures of the "Functions passed in" group can
// be injected: it throws, or when its return type is a promise it returns one that rejects. With no
// failure injected it returns a value of its return type.

import { failureIdsOf } from "../world/failures.ts";
import { nowRunning } from "../world/current.ts";

// What the function passed in does when it is called with no failure injected: builds the value it
// returns.
export interface IReturnBuilder {
    // Builds one value of the function's return type.
    build(): unknown;
}

// The failures a call of a function passed in can be given: both when it returns a promise, only
// throwing when it does not, because a function that returns no promise has no promise to reject.
export function passedInFailures(returnsPromise: boolean): string[] {
    if (returnsPromise) {
        return failureIdsOf("function-passed-in");
    }
    return ["throws"];
}

// Builds a function to pass in. Called while a run is in flight, it asks the run's injector whether
// this call fails; called with no run in flight, as when the tool itself calls it, it never fails.
export function passedInFunction(returnsPromise: boolean, returns: IReturnBuilder): (...parameters: unknown[]) => unknown {
    const possible = passedInFailures(returnsPromise);
    return function passedIn(): unknown {
        const subject = nowRunning();
        if (subject !== undefined) {
            const failure = subject.injector.check("function-passed-in", possible);
            if (failure === "throws") {
                throw new Error("A function Faultline passed in threw, because the run injected that failure.");
            }
            if (failure === "rejects") {
                return Promise.reject(new Error("A function Faultline passed in rejected, because the run injected that failure."));
            }
        }
        return returns.build();
    };
}
