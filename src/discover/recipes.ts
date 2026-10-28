// Turns a parameter's type into a recipe for building values of it.
//
// A recipe is plain data, so it travels to the process that does the driving and is written into
// the report file without anything having to be rebuilt.

import assert from "node:assert/strict";
import ts from "typescript";
import { isSimFile } from "./sources.ts";

// The types a run supplies itself rather than building. A scenario takes a scenario context and an
// expectation function takes an expectation context, both only in a sim file. A signal is built by
// the run because what it carries is whether the run has given up on the call.
export type EffectKind = "scenario" | "expectation" | "signal";

// The runtime types a run builds as bytes. The name is kept, because a `Buffer` has methods a
// plain `Uint8Array` lacks and an `ArrayBuffer` is no array of bytes at all.
export type BytesName = "Uint8Array" | "Buffer" | "ArrayBuffer";

// The runtime error types a run builds. The name is kept, because code under test tells them apart
// with `instanceof`.
export type ErrorName = "Error" | "TypeError" | "RangeError";

// One property of an object a recipe builds.
export interface Property {
    // What the property is called.
    name: string;

    // How to build its value.
    recipe: Recipe;

    // Whether a value may be left out.
    optional: boolean;
}

// How to build one value.
export type Recipe =
    | { kind: "unknown"; text: string }
    | { kind: "any" }
    | { kind: "string" }
    | { kind: "number" }
    | { kind: "bigint" }
    | { kind: "boolean" }
    | { kind: "null" }
    | { kind: "undefined" }
    | { kind: "void" }
    | { kind: "never" }
    | { kind: "literal"; value: string | number | boolean }
    | { kind: "union"; options: Recipe[] }
    | { kind: "array"; element: Recipe }
    | { kind: "tuple"; elements: Recipe[] }
    | { kind: "object"; properties: Property[]; index?: Recipe }
    | { kind: "map"; key: Recipe; value: Recipe }
    | { kind: "set"; element: Recipe }
    | { kind: "date" }
    | { kind: "regexp" }
    | { kind: "url" }
    | { kind: "bytes"; name: BytesName }
    | { kind: "error"; name: ErrorName }
    | { kind: "promise"; value: Recipe }
    | { kind: "function"; returns: Recipe }
    | { kind: "effect"; effect: EffectKind }
    | { kind: "named"; key: string; name: string; structural: Recipe };

// What a type is called, for the line asking for a value factory.
//
// The checker writes a type out in full, and a type built out of many others runs past a line. It
// is cut short rather than written out, because the line is read by somebody deciding what to
// write. Taking the repeated parts out of it was tried and taken out: a name with the repeats gone
// is a different type from the one the person has to write a factory for.
export function nameOf(checker: ts.TypeChecker, type: ts.Type): string {
    const written = checker.typeToString(type);
    if (written.length <= longestTypeName) {
        return written;
    }
    return `${written.slice(0, longestTypeName)}...`;
}

// How long a type name may be before the line naming it is cut short. Eighty is a terminal's width,
// and a name longer than a line is read by nobody.
const longestTypeName = 80;

// The types the run supplies, by the name each one is declared under in the module sim files import
// their types from. Both the interface and the name the docs teach are here, because the checker
// reports whichever the parameter was written with.
const effectByName: Record<string, EffectKind> = {
    IScenarioContext: "scenario",
    ScenarioContext: "scenario",
    IExpectationContext: "expectation",
    ExpectationContext: "expectation",
};

// What the recipe reader is wired to.
export interface RecipeContext {
    // The checker the types come from.
    checker: ts.TypeChecker;

    // The files the types sim files import may be declared in, which is how a context type is told
    // from a type that merely carries the same name. A clone resolves it to the tool's own
    // TypeScript and an installed copy resolves it to the declarations the build emitted, so both
    // are named.
    simTypesFile: string[];

    // The root every type key is written relative to.
    root: string;
}

// Reads a type and says how to build values of it. `at` is the node the type was read at, which is
// what property types are resolved against.
export function recipeFor(context: RecipeContext, type: ts.Type, at: ts.Node): Recipe {
    return recipeWithin({ context, at, path: [], within: new Set(), read: new Map() }, type);
}

// What one reading of a parameter's type carries down through the types inside it.
export interface Reading {
    // What the recipe reader is wired to.
    context: RecipeContext;

    // The node the type was read at, which property types are resolved against.
    at: ts.Node;

    // The declarations of the project's own types being read on the way down to this one. A type
    // whose declaration is already here refers to itself, and reading it again would never end.
    path: ts.Symbol[];

    // Every type being read on the way down to this one. A type with no name can hold itself as
    // well, as a browser's window holds the window.
    within: Set<ts.Type>;

    // Every type this reading has finished, so a type that many properties share is read once. A
    // wide type whose properties share types of their own is read in time that grows with how many
    // types there are, not with how many ways there are to reach each one.
    read: Map<ts.Type, Recipe>;
}

// Reads one type inside the reading of a parameter's type.
export function recipeWithin(reading: Reading, type: ts.Type): Recipe {
    const checker = reading.context.checker;

    const flags = type.flags;
    if (flags & ts.TypeFlags.Any) {
        return { kind: "any" };
    }
    if (flags & ts.TypeFlags.Unknown) {
        return { kind: "any" };
    }
    if (flags & ts.TypeFlags.Never) {
        return { kind: "never" };
    }
    if (flags & ts.TypeFlags.Null) {
        return { kind: "null" };
    }
    if (flags & (ts.TypeFlags.Undefined | ts.TypeFlags.VoidLike)) {
        return flags & ts.TypeFlags.Undefined ? { kind: "undefined" } : { kind: "void" };
    }
    if (flags & ts.TypeFlags.BooleanLiteral) {
        return { kind: "literal", value: checker.typeToString(type) === "true" };
    }
    if (flags & ts.TypeFlags.Boolean) {
        return { kind: "boolean" };
    }
    if (type.isStringLiteral()) {
        return { kind: "literal", value: type.value };
    }
    if (type.isNumberLiteral()) {
        return { kind: "literal", value: type.value };
    }
    if (flags & ts.TypeFlags.String) {
        return { kind: "string" };
    }
    if (flags & ts.TypeFlags.Number) {
        return { kind: "number" };
    }
    if (flags & ts.TypeFlags.BigIntLike) {
        return { kind: "bigint" };
    }
    if (flags & ts.TypeFlags.ESSymbolLike) {
        return { kind: "unknown", text: "symbol" };
    }
    // An enum is a number or a string, whichever its members are.
    //
    // Reading it as the union of its members was tried and taken out: a compiler's own kind of
    // syntax has three hundred and fifty of them, and writing that union down everywhere one is
    // mentioned made the run's own description too big to write out at all. The members that
    // matter are the ones the file being measured names, and those are read out of the file and
    // handed to the run whatever the type says.
    if (flags & ts.TypeFlags.EnumLike) {
        return type.isUnion() && type.types.some((one) => one.isStringLiteral()) ? { kind: "string" } : { kind: "number" };
    }

    // Everything above holds one value or is a value of its own. Everything below reads the types
    // inside a type, and that is what has to stop on a type that refers to itself.
    const done = reading.read.get(type);
    if (done !== undefined) {
        return done;
    }
    const own = ownSymbol(type);
    if (reading.within.has(type) || (own !== undefined && reading.path.includes(own))) {
        // The type is one of the types it is inside. Its value is built where the reading first
        // met it, and this is the place inside that value where the reading stops, so the value
        // ends with an empty object here.
        return { kind: "object", properties: [] };
    }
    if (own !== undefined) {
        reading.path.push(own);
    }
    reading.within.add(type);
    const recipe = structuredRecipe(reading, type);
    reading.within.delete(type);
    if (own !== undefined) {
        reading.path.pop();
    }
    reading.read.set(type, recipe);
    return recipe;
}

// The declaration of a project's own type, which is what says the reading has come back round to
// it. A type the runtime declares, such as an array, is left out: an array of arrays is two
// arrays, not an array that holds itself.
function ownSymbol(type: ts.Type): ts.Symbol | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol === undefined) {
        return undefined;
    }
    if (isOutsideTheProject(symbol)) {
        return undefined;
    }
    return symbol;
}

//
// Whether the type is an object type a package or a declaration file declares under a name of its
// own, other than the runtime types the run builds itself. Such a type is a closed box: the run
// does not read what is inside it and asks the person for a value factory instead, because a
// library's types can go on for ever: a zod schema's `.optional()` returns a new type wrapping the
// schema it was called on, so every level is a type the reading has not met before. A limit on the
// depth would be a guess that a deeper type breaks.
//
export function isLibraryType(type: ts.Type): boolean {
    if ((type.flags & ts.TypeFlags.Object) === 0) {
        return false;
    }
    const symbol = type.getSymbol();
    if (symbol === undefined) {
        return false;
    }
    if (!isOutsideTheProject(symbol)) {
        return false;
    }
    const name = symbol.getName();
    assert(name.length > 0, "A type's symbol has a name.");
    if (name.startsWith("__")) {
        //
        // A type written out where it is used, such as the object a mapped type like `Record`
        // makes, has no name to ask for a factory by and is read for what it holds.
        //
        return false;
    }
    return !builtInNames.has(name);
}

//
// The recipe of a library type: its key, by which a value factory returning it is found, around a
// recipe the run cannot build, so the checklist asks for a factory when no sim file has one.
//
export function libraryRecipe(context: RecipeContext, type: ts.Type): Recipe {
    assert(isLibraryType(type), "Only a library type has a library recipe.");
    //
    // The symbol is there, because `isLibraryType` read it.
    //
    const symbol = type.getSymbol()!;
    const recipe = named(context, type, {
        kind: "unknown",
        text: symbol.getName(),
    });
    assert.equal(recipe.kind, "named");
    return recipe;
}

// Reads a type made of other types: a union, an intersection, a built in container, a function, a
// tuple or an object.
function structuredRecipe(reading: Reading, type: ts.Type): Recipe {
    const context = reading.context;
    const at = reading.at;
    const checker = context.checker;
    const flags = type.flags;
    if (flags & ts.TypeFlags.TypeParameter) {
        const constraint = checker.getBaseConstraintOfType(type);
        if (constraint === undefined || constraint === type) {
            // A type parameter with no constraint stands for whatever the caller passes, so the
            // run passes whatever it has, the same as an ordinary caller.
            return { kind: "any" };
        }
        return recipeWithin(reading, constraint);
    }
    if (type.isUnion()) {
        const options = type.types.map((one) => recipeWithin(reading, one));
        return { kind: "union", options: options.filter((one) => one.kind !== "never") };
    }
    if (type.isIntersection()) {
        return intersectionRecipe(reading, type);
    }

    const effect = effectRecipe(context, type, at);
    if (effect !== undefined) {
        return effect;
    }

    const built = builtInRecipe(reading, type);
    if (built !== undefined) {
        return named(context, type, built);
    }

    //
    // A library type that can be called and also has properties of its own, such as an Express
    // app, is the library's object, not a function: a function built for it would have none of
    // its methods. A library type that is a call signature and nothing more is a function.
    //
    if (isLibraryType(type)) {
        if (type.getProperties().length > 0) {
            return libraryRecipe(context, type);
        }
    }

    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
        const signature = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0]!;
        return { kind: "function", returns: recipeWithin(reading, checker.getReturnTypeOfSignature(signature)) };
    }

    if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) {
        return { kind: "unknown", text: nameOf(checker, type) };
    }

    if (isTupleLike(checker, type)) {
        const elements = checker.getTypeArguments(type as ts.TypeReference);
        return { kind: "tuple", elements: elements.map((one) => recipeWithin(reading, one)) };
    }

    if (isLibraryType(type)) {
        return libraryRecipe(context, type);
    }

    if (flags & ts.TypeFlags.Object) {
        return named(context, type, objectRecipe(reading, type));
    }

    return { kind: "unknown", text: nameOf(checker, type) };
}

// A stable name for a type, so a factory written for it is found again on the next run. It is the
// file the type was declared in and the name it was declared under.
export function typeKeyOf(context: RecipeContext, type: ts.Type): string | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol === undefined) {
        return undefined;
    }
    const declaration = symbol.declarations?.[0];
    if (declaration === undefined) {
        return undefined;
    }
    if (symbol.getName().startsWith("__")) {
        // A type written out where it is used rather than declared under a name of its own. The
        // compiler calls it `__type`, which is no name to ask somebody for a factory by, and its
        // properties are enough to build a value from.
        return undefined;
    }
    if (isOutsideTheProject(symbol)) {
        return libraryKey(context, type);
    }
    const file = declaration.getSourceFile().fileName;
    return `${relativeTo(context.root, file)}#${symbol.getName()}`;
}

//
// The key of a library type, which a value factory returning it is found by, or nothing for a type
// from outside the project the run builds or reads itself. It names the type's own declaration and
// not its type arguments, so one factory serves every use of a generic library type, as one factory
// serves every use of a generic type the project declares.
//
export function libraryKey(context: RecipeContext, type: ts.Type): string | undefined {
    if (!isLibraryType(type)) {
        return undefined;
    }
    //
    // The symbol and its declaration are there, because `isLibraryType` read them.
    //
    const symbol = type.getSymbol()!;
    const file = fileOfSymbol(symbol);
    assert(file.length > 0, "A library type is declared in a file.");
    const key = `${relativeTo(context.root, file)}#${symbol.getName()}`;
    assert(key.endsWith(`#${symbol.getName()}`));
    return key;
}

//
// The key a value factory for a built-in value type is found by, such as `builtin#string` or
// `builtin#Date`, or nothing for a recipe of any other kind. `unknown` and `any` are one kind,
// because the run builds a value of either the same way. The run builds these types itself and
// they have no declaration of the project's to name, so the kind of value names them: a factory
// returning a `Date` serves every `Date` parameter it is used for, whatever wrote the type.
//
export function leafKey(recipe: Recipe): string | undefined {
    const kinds: Record<string, string> = {
        any: "unknown",
        string: "string",
        number: "number",
        bigint: "bigint",
        boolean: "boolean",
        date: "Date",
        regexp: "RegExp",
        url: "URL",
    };
    const kind = kinds[recipe.kind];
    if (kind !== undefined) {
        return `builtin#${kind}`;
    }
    if (recipe.kind === "bytes") {
        return `builtin#${recipe.name}`;
    }
    if (recipe.kind === "error") {
        return `builtin#${recipe.name}`;
    }
    //
    // `object` names any value that is not a primitive, which the run cannot build without knowing
    // more, so a factory returning `object` is what builds one.
    //
    if (recipe.kind === "unknown") {
        if (recipe.text === "object") {
            return "builtin#object";
        }
    }
    return undefined;
}

//
// The key and name of a type alias the project declares, as a parameter or a return type writes it
// (`record: JsonObject`), or nothing when the type is written some other way. The checker gives a
// value of an alias of a generic library type, such as `type JsonObject = Readonly<Record<string,
// unknown>>`, the library's alias (`Readonly`) and not the project's, so the project's name is
// read off the type as it is written, where a value factory returning it and a parameter taking it
// both name it.
//
export function writtenAliasKey(context: RecipeContext, written: ts.TypeNode | undefined): { key: string; name: string } | undefined {
    if (!written) {
        return undefined;
    }
    if (!ts.isTypeReferenceNode(written)) {
        return undefined;
    }
    //
    // The checker gives every name a type is written with a symbol, a made-up one for a name
    // declared nowhere.
    //
    let symbol = context.checker.getSymbolAtLocation(written.typeName);
    assert(symbol !== undefined, `The checker gave the type ${written.getText()} no symbol.`);
    if (symbol.flags & ts.SymbolFlags.Alias) {
        symbol = context.checker.getAliasedSymbol(symbol);
    }
    if (!(symbol.flags & ts.SymbolFlags.TypeAlias)) {
        return undefined;
    }
    //
    // The checker makes up a symbol for a name declared nowhere, which has no declaration and so
    // no file to name it by.
    //
    if (!symbol.declarations?.length) {
        return undefined;
    }
    if (isOutsideTheProject(symbol)) {
        return undefined;
    }
    const key = `${relativeTo(context.root, fileOfSymbol(symbol))}#${symbol.getName()}`;
    assert(key.endsWith(`#${symbol.getName()}`));
    return { key, name: symbol.getName() };
}

//
// A parameter's recipe under the project's own name for its type, when the parameter writes a type
// alias the project declares and the recipe does not already carry that alias's key, so a value
// factory returning the alias is found for it.
//
export function recipeUnderWrittenAlias(context: RecipeContext, recipe: Recipe, written: ts.TypeNode | undefined): Recipe {
    //
    // The contexts Faultline hands a scenario or an expectation function are told apart by their
    // own recipe, whatever name they are written with, so they are never put under another.
    //
    if (recipe.kind === "effect") {
        return recipe;
    }
    const alias = writtenAliasKey(context, written);
    if (!alias) {
        return recipe;
    }
    if (recipe.kind === "named") {
        if (recipe.key === alias.key) {
            return recipe;
        }
    }
    return { kind: "named", key: alias.key, name: alias.name, structural: recipe };
}

// Wraps a recipe with the key a factory is looked up by, when the type has one.
function named(context: RecipeContext, type: ts.Type, structural: Recipe): Recipe {
    const key = typeKeyOf(context, type);
    if (key === undefined) {
        return structural;
    }
    // The key was built from this type's symbol, so it has one and that symbol carries the name.
    const symbol = (type.aliasSymbol ?? type.getSymbol())!;
    return { kind: "named", key, name: symbol.getName(), structural };
}

// The recipe for a type the run supplies itself, or nothing when it supplies none.
//
// Only a sim file is supplied one. The injector and the checklist are what a scenario asks the run
// for, and code being measured has no business knowing the run is there at all, so a parameter of
// one of those types in a source file is an ordinary parameter the person is asked for a factory
// for rather than something the tool quietly fills.
function effectRecipe(context: RecipeContext, type: ts.Type, at: ts.Node): Recipe | undefined {
    if (!isSimFile(at.getSourceFile().fileName)) {
        return undefined;
    }
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol === undefined) {
        return undefined;
    }
    const kind = effectByName[symbol.getName()];
    if (kind === undefined) {
        return undefined;
    }
    if (!context.simTypesFile.includes(fileOfSymbol(symbol))) {
        return undefined;
    }
    return { kind: "effect", effect: kind };
}

//
// The names of the runtime types `builtInRecipe` builds, which are never library types however
// they are declared.
//
const builtInNames: ReadonlySet<string> = new Set([
    "Array",
    "ReadonlyArray",
    "Promise",
    "Map",
    "ReadonlyMap",
    "Set",
    "ReadonlySet",
    "Date",
    "RegExp",
    "URL",
    "Uint8Array",
    "Buffer",
    "ArrayBuffer",
    "Error",
    "TypeError",
    "RangeError",
    "AbortSignal",
]);

// The recipe for one of the types every JavaScript runtime already has, or nothing when the type
// is not one of them.
function builtInRecipe(reading: Reading, type: ts.Type): Recipe | undefined {
    const checker = reading.context.checker;
    const symbol = type.getSymbol();
    if (symbol === undefined || !isOutsideTheProject(symbol)) {
        // A project is free to declare `Array`, `Map` or `Set` of its own, and one that does means
        // its own. Only a declaration the project did not write is the runtime's, and a type the
        // project wrote is read for what it holds.
        return undefined;
    }
    const name = symbol.getName();
    const args = checker.getTypeArguments(type as ts.TypeReference);
    if (name === "Array" || name === "ReadonlyArray") {
        return { kind: "array", element: recipeWithin(reading, args[0]!) };
    }
    if (name === "Promise") {
        return { kind: "promise", value: recipeWithin(reading, args[0]!) };
    }
    if (name === "Map" || name === "ReadonlyMap") {
        return {
            kind: "map",
            key: recipeWithin(reading, args[0]!),
            value: recipeWithin(reading, args[1]!),
        };
    }
    if (name === "Set" || name === "ReadonlySet") {
        return { kind: "set", element: recipeWithin(reading, args[0]!) };
    }
    if (name === "Date") {
        return { kind: "date" };
    }
    if (name === "RegExp") {
        return { kind: "regexp" };
    }
    if (name === "URL") {
        return { kind: "url" };
    }
    if (name === "Uint8Array" || name === "Buffer" || name === "ArrayBuffer") {
        return { kind: "bytes", name };
    }
    if (name === "Error" || name === "TypeError" || name === "RangeError") {
        return { kind: "error", name };
    }
    if (name === "AbortSignal") {
        return { kind: "effect", effect: "signal" };
    }
    return undefined;
}

// The recipe for a plain object or an instance of a class, read from the properties it has.
function objectRecipe(reading: Reading, type: ts.Type): Recipe {
    const checker = reading.context.checker;
    const properties: Property[] = [];
    for (const symbol of checker.getPropertiesOfType(type)) {
        const propertyType = checker.getTypeOfSymbolAtLocation(symbol, reading.at);
        properties.push({
            name: symbol.getName(),
            recipe: recipeWithin(reading, propertyType),
            optional: (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0,
        });
    }
    const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    if (stringIndex !== undefined) {
        return {
            kind: "object",
            properties,
            index: recipeWithin(reading, stringIndex.type),
        };
    }
    return { kind: "object", properties };
}

// The recipe for an intersection, which is every part's properties put together.
function intersectionRecipe(reading: Reading, type: ts.IntersectionType): Recipe {
    const merged = objectRecipe(reading, type);
    if (merged.kind === "object" && merged.properties.length === 0) {
        return { kind: "unknown", text: nameOf(reading.context.checker, type) };
    }
    return merged;
}

// The file a symbol was declared in.
//
// A symbol the checker made up rather than read out of a file was declared in none, and is named by
// the empty path. No list of files holds it and no directory is inside it, so every question asked
// of it below answers the way it answers for a file nobody named.
function fileOfSymbol(symbol: ts.Symbol): string {
    return symbol.declarations?.[0]?.getSourceFile().fileName ?? "";
}

// Whether the type this symbol declares is one the project did not write.
//
// Somebody else's code and a declaration file are both outside the project: the first is a package
// the project installed and the second says what something already built looks like. Neither is a
// type to ask the person for a factory for, and a name the runtime already uses means the
// runtime's only when it is declared in one of them.
function isOutsideTheProject(symbol: ts.Symbol): boolean {
    const file = fileOfSymbol(symbol);
    return file.includes("/node_modules/") || file.endsWith(".d.ts");
}

// Whether the type is a tuple, which is written out element by element rather than as a list of
// one type.
function isTupleLike(checker: ts.TypeChecker, type: ts.Type): boolean {
    const asReference = type as ts.TypeReference;
    if (asReference.target === undefined) {
        return false;
    }
    return (asReference.target.objectFlags & ts.ObjectFlags.Tuple) !== 0;
}

// A path written relative to the root, the one way, so a key reads the same on every machine.
function relativeTo(root: string, file: string): string {
    if (file.startsWith(`${root}/`)) {
        return file.slice(root.length + 1);
    }
    return file;
}
