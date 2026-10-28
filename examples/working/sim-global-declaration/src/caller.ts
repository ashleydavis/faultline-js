//
// Who is making a call, declared for every file of the project.
//

declare global {
    //
    // The person a call is made for.
    //
    interface ICaller {
        //
        // Their name, or the empty string when they gave none.
        //
        name: string;
    }
}

export {};
