// A function that reads the document, which only a browser has.

export function titleLength(): number {
    if (document.title === "") {
        return 0;
    }
    return document.title.length;
}

// Whether an element is on the page.
export function isShowing(id: string): boolean {
    const found = document.getElementById(id);
    if (found === null) {
        return false;
    }
    return found.isConnected;
}
