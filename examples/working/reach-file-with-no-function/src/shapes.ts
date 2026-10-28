//
// Types and constants, with no function.
//

//
// The size of a picture.
//
export interface IMeasurement {
    //
    // How wide, in pixels.
    //
    width: number;

    //
    // How tall, in pixels.
    //
    height: number;
}

//
// The largest a side of a picture may be, in pixels. It is what the code beside this file checks
// against.
//
export const BIGGEST_SIDE = 4096;
