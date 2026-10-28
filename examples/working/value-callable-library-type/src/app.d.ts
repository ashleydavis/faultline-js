//
// An app as a web framework's declaration file declares one: a function that answers a request,
// with methods of its own.
//

//
// The app.
//
export interface App {
    //
    // Answers one request.
    //
    (request: string): void;

    //
    // Starts listening on a port, and says whether it could.
    //
    listen(port: number): boolean;
}
