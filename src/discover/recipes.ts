// Turns a parameter's type into a recipe for building values of it.
//
// A recipe is plain data, so it travels to the process that does the driving and is written into
// the report file without anything having to be rebuilt.

import ts from "typescript";

// The types a run supplies itself rather than building. A sim file's scenario takes them, and a
// file being measured takes none of them: what it reaches for is replaced underneath it.
export type EffectKind = "injector" | "checklist" | "signal";

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
    | { kind: "bytes" }
    | { kind: "error" }
    | { kind: "promise"; value: Recipe }
    | { kind: "function"; returns: Recipe }
    | { kind: "effect"; effect: EffectKind }
    | { kind: "named"; key: string; name: string; structural: Recipe };

// How deep a recipe is allowed to go. A type that holds itself, such as a tree node, would go on
// for ever, and six levels is deeper than any value a call needs to be interesting.
const deepestRecipe = 6;

// The types the run supplies, by the name each one is declared under in the runtime module.
const effectByName: Record<string, EffectKind> = {
    Injector: "injector",
    Checklist: "checklist",
};

// What the recipe reader is wired to.
export interface RecipeContext {
    // The checker the types come from.
    checker: ts.TypeChecker;

    // The files the runtime module may be declared in, which is how an effect type is told from a
    // type that merely carries the same name. A clone resolves it to the tool's own TypeScript and
    // an installed copy resolves it to the declarations the build emitted, so both are named.
    runtimeFile: string[];

    // The root every type key is written relative to.
    root: string;
}

// Reads a type and says how to build values of it. `at` is the node the type was read at, which is
// what property types are resolved against.
export function recipeFor(context: RecipeContext, type: ts.Type, at: ts.Node, depth = 0): Recipe {
    const checker = context.checker;

    if (depth > deepestRecipe) {
        return { kind: "unknown", text: checker.typeToString(type) };
    }

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
    if (flags & ts.TypeFlags.TypeParameter) {
        const constraint = checker.getBaseConstraintOfType(type);
        if (constraint === undefined || constraint === type) {
            // A type parameter with no constraint stands for whatever the caller passes, so the
            // run passes whatever it has, the same as an ordinary caller.
            return { kind: "any" };
        }
        return recipeFor(context, constraint, at, depth + 1);
    }
    if (type.isUnion()) {
        const options = type.types.map((one) => recipeFor(context, one, at, depth + 1));
        return { kind: "union", options: options.filter((one) => one.kind !== "never") };
    }
    if (type.isIntersection()) {
        return intersectionRecipe(context, type, at, depth);
    }

    const effect = effectRecipe(context, type);
    if (effect !== undefined) {
        return effect;
    }

    const built = builtInRecipe(context, type, at, depth);
    if (built !== undefined) {
        return named(context, type, built);
    }

    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0) {
        const signature = checker.getSignaturesOfType(type, ts.SignatureKind.Call)[0]!;
        return { kind: "function", returns: recipeFor(context, checker.getReturnTypeOfSignature(signature), at, depth + 1) };
    }

    if (checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0) {
        return { kind: "unknown", text: checker.typeToString(type) };
    }

    if (isTupleLike(checker, type)) {
        const elements = checker.getTypeArguments(type as ts.TypeReference);
        return { kind: "tuple", elements: elements.map((one) => recipeFor(context, one, at, depth + 1)) };
    }

    if (flags & ts.TypeFlags.Object) {
        return named(context, type, objectRecipe(context, type, at, depth));
    }

    return { kind: "unknown", text: checker.typeToString(type) };
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
    const file = declaration.getSourceFile().fileName;
    if (file.includes("/node_modules/") || file.endsWith(".d.ts")) {
        return undefined;
    }
    return `${relativeTo(context.root, file)}#${symbol.getName()}`;
}

// Wraps a recipe with the key a factory is looked up by, when the type has one.
function named(context: RecipeContext, type: ts.Type, structural: Recipe): Recipe {
    const key = typeKeyOf(context, type);
    if (key === undefined) {
        return structural;
    }
    const symbol = type.aliasSymbol ?? type.getSymbol();
    return { kind: "named", key, name: symbol?.getName() ?? key, structural };
}

// The recipe for a type the run supplies itself, or nothing when it supplies none.
function effectRecipe(context: RecipeContext, type: ts.Type): Recipe | undefined {
    const symbol = type.aliasSymbol ?? type.getSymbol();
    if (symbol === undefined) {
        return undefined;
    }
    const kind = effectByName[symbol.getName()];
    if (kind === undefined) {
        return undefined;
    }
    const declared = symbol.declarations?.[0]?.getSourceFile().fileName;
    if (declared === undefined || !context.runtimeFile.includes(declared)) {
        return undefined;
    }
    return { kind: "effect", effect: kind };
}

// The recipe for one of the types every JavaScript runtime already has, or nothing when the type
// is not one of them.
function builtInRecipe(context: RecipeContext, type: ts.Type, at: ts.Node, depth: number): Recipe | undefined {
    const checker = context.checker;
    const symbol = type.getSymbol();
    const name = symbol?.getName();
    if (name === undefined) {
        return undefined;
    }
    const args = checker.getTypeArguments(type as ts.TypeReference);
    if (name === "Array" || name === "ReadonlyArray") {
        if (args[0] === undefined) {
            return { kind: "array", element: { kind: "any" } };
        }
        return { kind: "array", element: recipeFor(context, args[0], at, depth + 1) };
    }
    if (name === "Promise") {
        return { kind: "promise", value: args[0] === undefined ? { kind: "undefined" } : recipeFor(context, args[0], at, depth + 1) };
    }
    if (name === "Map" || name === "ReadonlyMap") {
        return {
            kind: "map",
            key: args[0] === undefined ? { kind: "string" } : recipeFor(context, args[0], at, depth + 1),
            value: args[1] === undefined ? { kind: "string" } : recipeFor(context, args[1], at, depth + 1),
        };
    }
    if (name === "Set" || name === "ReadonlySet") {
        return { kind: "set", element: args[0] === undefined ? { kind: "string" } : recipeFor(context, args[0], at, depth + 1) };
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
        return { kind: "bytes" };
    }
    if (name === "Error" || name === "TypeError" || name === "RangeError") {
        return { kind: "error" };
    }
    if (name === "AbortSignal") {
        return { kind: "effect", effect: "signal" };
    }
    return undefined;
}

// The recipe for a plain object or an instance of a class, read from the properties it has.
function objectRecipe(context: RecipeContext, type: ts.Type, at: ts.Node, depth: number): Recipe {
    const checker = context.checker;
    const properties: Property[] = [];
    for (const symbol of checker.getPropertiesOfType(type)) {
        const propertyType = checker.getTypeOfSymbolAtLocation(symbol, at);
        properties.push({
            name: symbol.getName(),
            recipe: recipeFor(context, propertyType, at, depth + 1),
            optional: (symbol.getFlags() & ts.SymbolFlags.Optional) !== 0,
        });
    }
    const stringIndex = checker.getIndexInfoOfType(type, ts.IndexKind.String);
    if (stringIndex !== undefined) {
        return {
            kind: "object",
            properties,
            index: recipeFor(context, stringIndex.type, at, depth + 1),
        };
    }
    return { kind: "object", properties };
}

// The recipe for an intersection, which is every part's properties put together.
function intersectionRecipe(context: RecipeContext, type: ts.IntersectionType, at: ts.Node, depth: number): Recipe {
    const merged = objectRecipe(context, type, at, depth);
    if (merged.kind === "object" && merged.properties.length === 0) {
        return { kind: "unknown", text: context.checker.typeToString(type) };
    }
    return merged;
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
