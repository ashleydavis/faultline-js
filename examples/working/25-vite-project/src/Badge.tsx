// A .tsx file, which a bundler project has and a Node one usually does not.

export interface BadgeProps {
    // How many to show.
    count: number;

    // What to put after the count.
    label?: string;
}

export function badgeText(props: BadgeProps): string {
    if (props.count > 99) {
        return "99+";
    }
    return `${props.count}${props.label ?? ""}`;
}
