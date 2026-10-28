//
// What the worker and its child say to each other, and what the child knows about one shard.
//
// The worker asks the child to open a shard (one source file or one sim file) and then sends it
// calls as replay tokens, one at a time. The child answers each with what the call exercised, the
// places it reached and the failures it found. Everything here crosses a process boundary as JSON,
// so it is data and nothing else.
//

import type { NotProvable } from "../coverage/paths.ts";
import type { UncallableFunction } from "../discover/functions.ts";
import type { IChoice } from "../values/choices.ts";
import type { ReachedPlace } from "../world/injector.ts";
import type { ICallLimits } from "./call.ts";
import type { IFailure } from "./judge.ts";

//
// What a child is started with.
//
export interface IChildSettings {
    //
    // The absolute path of the project being fault tested.
    //
    projectRoot: string;

    //
    // The absolute path of the directory Faultline's own modules sit in.
    //
    toolModules: string;

    //
    // The files the types a sim file imports from `faultline` may be declared in, which is how a
    // scenario and an expectation function are told by their parameter.
    //
    simTypes: string[];

    //
    // How long a call may take.
    //
    limits: ICallLimits;
}

//
// What the worker asks of its child.
//
export interface IRequest {
    //
    // Which request it is.
    //
    kind: "open" | "call" | "read";
}

//
// Opens one shard: reads it, loads it and lists what can be called in it.
//
export interface IOpenRequest extends IRequest {
    //
    // It opens a shard.
    //
    kind: "open";

    //
    // The source file or sim file, relative to the project root.
    //
    file: string;

    //
    // The sim files whose value factories and expectation functions the shard uses, relative to the
    // project root: the one beside a source file, then every `global.sim.ts`. For a sim file it is
    // the sim file itself.
    //
    sims: string[];

    //
    // The run's seed.
    //
    seed: number;
}

//
// Makes one call in the shard that is open.
//
export interface ICallRequest extends IRequest {
    //
    // It makes a call.
    //
    kind: "call";

    //
    // The call, as its replay token.
    //
    token: string;

    //
    // Whether the child takes a coverage reading after the call. Without one, what the call ran is
    // counted in the next reading, because a reading costs more the more modules the child holds
    // and the run needs only what every call together exercised.
    //
    read: boolean;
}

//
// Takes a coverage reading of what the calls since the last one exercised.
//
export interface IReadRequest extends IRequest {
    //
    // It takes a reading.
    //
    kind: "read";
}

//
// What the child answers.
//
export interface IReply {
    //
    // Which answer it is.
    //
    kind: "opened" | "called" | "read";
}

//
// The answer to an open request.
//
export interface IOpenedReply extends IReply {
    //
    // The shard is open.
    //
    kind: "opened";

    //
    // What the child read and loaded.
    //
    shard: IShardFacts;
}

//
// The answer to a call request.
//
export interface ICalledReply extends IReply {
    //
    // The call was made.
    //
    kind: "called";

    //
    // What it did.
    //
    result: ICallResult;
}

//
// The answer to a read request.
//
export interface IReadReply extends IReply {
    //
    // The reading was taken.
    //
    kind: "read";

    //
    // The keys of the code paths the calls since the last reading exercised.
    //
    exercised: string[];
}

//
// One code path of the shard's file, as the report lists it.
//
export interface IPathRecord {
    //
    // The key the path is counted under: its file and name.
    //
    key: string;

    //
    // The file, relative to the project root.
    //
    file: string;

    //
    // The line it starts on.
    //
    line: number;

    //
    // The function it belongs to, as the report labels it.
    //
    fn: string;

    //
    // What the path is, written for the checklist.
    //
    describe: string;
}

//
// One function of the shard, with what the worker needs to plan its calls.
//
export interface IFunctionPlan {
    //
    // What the report calls it.
    //
    label: string;

    //
    // What a token names it as: its label, or for a second function with the same label (a getter
    // and a setter, say) its label and line.
    //
    name: string;

    //
    // The line it starts on.
    //
    line: number;

    //
    // Why Faultline cannot call it, or undefined when it can.
    //
    uncallable: string | undefined;

    //
    // The type of the first parameter Faultline has no value for, so the checklist can ask for a
    // value factory returning it, or undefined when every parameter has a value.
    //
    unbuildable: string | undefined;

    //
    // The choices for each parameter, in parameter order, the baseline first.
    //
    choices: IChoice[][];

    //
    // The keys of the code paths that must all be exercised before Faultline stops calling it: its
    // own, and those of the functions in the file that only it or no function in particular reaches.
    //
    targets: string[];
}

//
// One scenario of a sim file shard.
//
export interface IScenarioPlan {
    //
    // The name the sim file exports it under, which is also what a token names it as.
    //
    name: string;

    //
    // The line it starts on.
    //
    line: number;
}

//
// What a child read and loaded for one shard.
//
export interface IShardFacts {
    //
    // The source file or sim file, relative to the project root.
    //
    file: string;

    //
    // The functions of a source file, the top level first. A sim file has none.
    //
    functions: IFunctionPlan[];

    //
    // The scenarios of a sim file. A source file has none.
    //
    scenarios: IScenarioPlan[];

    //
    // Every code path of a source file that some count can prove ran.
    //
    paths: IPathRecord[];

    //
    // Every code path of a source file that no count can prove ran.
    //
    notProvable: NotProvable[];

    //
    // The functions of a source file Faultline cannot call, each with what stops it.
    //
    uncallable: UncallableFunction[];

    //
    // A sentence for each problem with the shard's sim files: an error the compiler found in one,
    // or one that failed to load.
    //
    simProblems: string[];

    //
    // A sentence saying why the shard's own file failed to load, so no function in it but the top
    // level could be called, or undefined when it loaded.
    //
    loadProblem: string | undefined;
}

//
// What one call did.
//
export interface ICallResult {
    //
    // The call, as its replay token.
    //
    token: string;

    //
    // The keys of every code path of the project's files that the call exercised.
    //
    exercised: string[];

    //
    // Every place the call reached, with the failures possible at each, in the order reached.
    //
    reached: ReachedPlace[];

    //
    // Whether the failure the call was planned with was injected.
    //
    injected: boolean;

    //
    // The failures the call found.
    //
    failures: IFailure[];

    //
    // Each value the call was made with, in parameter order, written as Node's `util.inspect` writes
    // it before the call was made, for the crash view. It is empty for a scenario and a top level.
    //
    arguments: string[];
}

//
// Whether a message from the child answers an open request.
//
export function isOpenedReply(message: IReply): message is IOpenedReply {
    return message.kind === "opened";
}

//
// Whether a message from the child answers a read request.
//
export function isReadReply(message: IReply): message is IReadReply {
    return message.kind === "read";
}
