// The one source of randomness a run has.
//
// Every value a run makes up, every fault it injects and every order it tries comes from here, so
// a run is reproduced by its seed and by nothing else.


// Mulberry32, which is thirty two bits of state and four operations per draw. It is used because a
// run needs the same numbers on every machine, which `Math.random` does not promise, and because
// its whole state is one number a plan can write down.
export class SeededRng {
    // The generator's whole state, advanced once per draw.
    private state: number;

    // Builds a generator from a seed. The seed is what a plan carries, so the same seed gives the
    // same run.
    constructor(seed: number) {
        // Kept inside thirty two bits because the generator's arithmetic is thirty two bit, and a
        // seed outside that range would fold onto one already used.
        this.state = seed >>> 0;
    }

    // The seed this generator would need to be built with to carry on from here.
    get position(): number {
        return this.state;
    }

    next(): number {
        // 0x6D2B79F5 is Mulberry32's published increment. Changing it changes every run's numbers,
        // so it is written here rather than made up.
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let mixed = this.state;
        mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
        mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
        // 4294967296 is two to the thirty second, which turns the thirty two bit result into a
        // fraction from zero up to but not including one.
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    }

    int(low: number, high: number): number {
        if (high < low) {
            return low;
        }
        return low + Math.floor(this.next() * (high - low + 1));
    }

    pick<T>(items: readonly T[]): T {
        if (items.length === 0) {
            throw new Error("Cannot pick from an empty list.");
        }
        return items[this.int(0, items.length - 1)]!;
    }

    bytes(count: number): Uint8Array {
        const out = new Uint8Array(count);
        for (let index = 0; index < count; index += 1) {
            out[index] = this.int(0, 255);
        }
        return out;
    }

    uuid(): string {
        const raw = this.bytes(16);
        // The two bytes below carry the version and the variant a version 4 identifier is required
        // to have, so a caller parsing the result reads it as one.
        raw[6] = (raw[6]! & 0x0f) | 0x40;
        raw[8] = (raw[8]! & 0x3f) | 0x80;
        const hex = [...raw].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
}
