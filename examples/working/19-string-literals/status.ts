// A branch per word, which no string a run makes up lands on.

export function meaningOf(word: string): string {
    if (word === "ok") {
        return "everything is fine";
    }
    if (word === "warn") {
        return "something may go wrong";
    }
    if (word === "fail") {
        return "something went wrong";
    }
    return "no idea what that means";
}
