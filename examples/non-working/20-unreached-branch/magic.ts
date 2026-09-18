// A branch that turns on a value written nowhere for the run to read.
//
// A value the file names is read out of the file and passed in, so the branch that turns on it is
// reached. This one turns on a value worked out while the code runs, so the run has nothing to read
// and the branch needs a scenario.

export function isMagic(word: string): boolean {
    if (word.length === word.split("").length + 7) {
        return true;
    }
    return false;
}
