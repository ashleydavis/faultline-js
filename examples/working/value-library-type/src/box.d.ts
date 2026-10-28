//
// A box from a library, declared the way a package declares its types. Wrapping a box gives a box
// of a box, a type the box itself does not hold, so every level is a new type.
//
export declare class Box<T> {
    //
    // What the box holds.
    //
    value: T;

    //
    // Puts the box inside another box.
    //
    wrap(): Box<Box<T>>;
}
