// How the report is written, so every line reads the same way.

// The words for the small counts a checklist prints, so a line reads as a sentence rather than as
// a number followed by a noun.
const words = [
    "No",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
];

// A count written the way a sentence starts with it. Past twelve the digits read better than the
// word, which is where the list above stops.
export function numberWord(count: number): string {
    return words[count] ?? String(count);
}

// A noun with its plural, chosen by the count in front of it.
export function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

// The percentage a run ends on. It is rounded down, so a run one path short of everything never
// reads as a hundred.
export function percentageOf(ticked: number, total: number): number {
    if (total === 0) {
        return 100;
    }
    return Math.floor((ticked * 100) / total);
}

// A name padded out so the counts beside it line up down the block.
export function padded(text: string, width: number): string {
    if (text.length >= width) {
        return `${text} `;
    }
    return text.padEnd(width);
}

// How long a run took, written the way somebody reads it back.
export function elapsed(milliseconds: number): string {
    if (milliseconds < 1000) {
        return "0s";
    }
    const seconds = Math.round(milliseconds / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
