//
// A `.tsx` file, which a bundler project has and a Node project usually does not.
//

import assert from "node:assert/strict";

//
// What a badge shows.
//
export interface IBadgeProps {
    //
    // How many to show.
    //
    count: number;

    //
    // What to put after the count, when there is something.
    //
    label?: string;
}

//
// Gives the text of a badge, capping the count at 99.
//
export function badgeText(props: IBadgeProps): string {
    assert(typeof props.count === "number");
    if (props.count > 99) {
        return "99+";
    }
    return `${props.count}${props.label ?? ""}`;
}
