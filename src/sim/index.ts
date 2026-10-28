//
// The types a sim file imports from the `faultline` package: the one parameter of a scenario and
// the one parameter of an expectation function, by which Faultline recognises each.
//

//
// The failures Faultline can inject, so a scenario can ask for one at a chosen place.
//
export interface IFaults {
    //
    // How many failures have been injected into the calls made through this control so far, so a
    // scenario can see whether the failure it asked for was used.
    //
    readonly injected: number;
}

//
// What a program the code under test runs prints and exits with, as a scenario says it does.
//
export interface IProgramAnswer {
    //
    // What it prints on its output stream.
    //
    stdout: string;

    //
    // What it prints on its error stream.
    //
    stderr: string;

    //
    // The code it exits with. Zero is a program that ended well.
    //
    exitCode: number;
}

//
// The programs of the run, which a scenario stands in for. No program is ever started: a program a
// scenario gives no answer for prints nothing and exits with code 0.
//
export interface IPrograms {
    //
    // Says what the program `name` answers for the rest of the scenario, whichever way the code
    // under test runs it. `name` is the program's file name, such as `ioreg`, or its full path.
    //
    answer(name: string, answer: IProgramAnswer): void;
}

//
// The one parameter of a scenario: a function in a sim file that calls the code under test with
// values its author chose.
//
export interface IScenarioContext {
    //
    // The failures Faultline can inject, so a scenario can ask for one at a chosen place.
    //
    readonly faults: IFaults;

    //
    // The programs the code under test runs, so a scenario can say what one prints.
    //
    readonly programs: IPrograms;

    //
    // Imports a file of the project afresh, running its top level again, for a file whose top level
    // needs files written or environment variables set first. The path is relative to the project
    // root, as `include` and `exclude` are.
    //
    load(path: string): Promise<Record<string, unknown>>;

    //
    // Imports a file of the project afresh as the process's entry point, the way `node` starts a
    // file: `import.meta.main` is true for it, for the rest of the scenario. The path is relative to
    // the project root.
    //
    start(path: string): Promise<Record<string, unknown>>;

    //
    // Says what the scenario expects to be true. When the condition is false the expectation is
    // recorded with the line it was made on and the scenario stops there.
    //
    expect(condition: boolean, expectation: string): void;
}

//
// The one parameter of an expectation function: a function in a sim file that checks expectations
// after every call of a function in the matching source file and after every scenario.
//
export interface IExpectationContext {
    //
    // Says what the function expects to be true. When the condition is false the expectation is
    // recorded with the line it was made on and the function stops there.
    //
    expect(condition: boolean, expectation: string): void;
}

//
// The names the user guide gives these types. A sim file writes `ScenarioContext`, because that is
// the name the docs teach, and the interfaces keep this codebase's `I` prefix.
//
export type Faults = IFaults;

//
// See `Faults`.
//
export type ScenarioContext = IScenarioContext;

//
// See `Faults`.
//
export type ProgramAnswer = IProgramAnswer;

//
// See `Faults`.
//
export type ExpectationContext = IExpectationContext;
