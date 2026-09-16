// Every arm of a switch is a path, and an arm that falls through is counted by the one it falls to.

// Named after what each arm answers.
export function nameOf(kind: 0 | 1 | 2 | 3): string {
    switch (kind) {
        case 0:
            return "none";
        case 1:
        case 2:
            return "some";
        default:
            return "many";
    }
}
