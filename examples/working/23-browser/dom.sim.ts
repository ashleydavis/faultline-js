// The two paths no made up call reaches: a page with no title, and an element that is there.

import type { Checklist, Injector } from "faultline";
import { isShowing, titleLength } from "./dom.ts";

export function aPageWithNoTitle(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const was = document.title;
    document.title = "";
    try {
        if (titleLength() !== 0) {
            throw new Error("TheEmptyTitleCountedAsSomething");
        }
    }
    finally {
        document.title = was;
    }
}

export function anElementThatIsThere(injector: Injector, checklist: Checklist): void {
    void injector;
    void checklist;

    const made = document.createElement("div");
    made.id = "put-there-by-the-scenario";
    document.body.appendChild(made);
    try {
        if (!isShowing("put-there-by-the-scenario")) {
            throw new Error("TheElementWasNotFound");
        }
    }
    finally {
        made.remove();
    }
}
