// A parameter whose type decides no value, so the function cannot be called until a factory
// beside it says what one looks like.

// A name that only this module can make.
export type Tag = symbol;

export function nameOf(tag: Tag): string {
    if (String(tag).length > 10) {
        return "long";
    }
    return "short";
}
