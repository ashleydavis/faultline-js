//
// The value factories a function's parameters can be built with, ready to call.
//
// The sim files have been loaded by the time a value is built, so a factory is looked up by the key
// of the type it returns and called. A factory written as a method on an exported class hands back
// the next value of whatever sequence the class keeps each time it is called, so the first values
// of the sequence are choices of their own. Each is built on a new instance of the class, with the
// method called once for the first value, twice for the second and so on, so that a value depends
// on its choice alone and never on the calls made before it.
//

import assert from "node:assert/strict";
import type { ParameterInfo } from "../discover/functions.ts";
import type { FactoryInfo } from "../discover/sim.ts";

//
// Builds the arguments a factory itself takes.
//
export interface IParameterBuilder {
    //
    // Builds one value for a parameter of a factory or of a factory class's constructor. The value
    // is of whatever type the parameter declares, which only the sim file knows.
    //
    build(parameter: ParameterInfo): unknown;
}

//
// How many values of a factory class's sequence are offered as choices. The first values of a
// sequence are where it starts and where it first moves on, which is what a function told apart by
// the order of values it is given needs.
//
export const seriesLength = 3;

//
// The factories of one call's sim files, by the key of the type each returns.
//
export interface IFactoryTable {
    //
    // How many values the factories returning the type with this key offer: one per function and
    // `seriesLength` per method of a factory class.
    //
    count(key: string): number;

    //
    // Builds the value at `index` among those the factories returning the type with this key offer,
    // in the order the sim files declare the factories.
    //
    make(key: string, index: number, parameters: IParameterBuilder): unknown;
}

//
// One value a factory offers: the factory and how many times it is called. A method of a factory
// class is called that many times on a new instance. The last call's value is the one offered.
//
export interface IFactoryValue {
    //
    // The factory.
    //
    factory: FactoryInfo;

    //
    // How many times it is called: once for a function and up to `seriesLength` times for a method.
    //
    calls: number;
}

//
// What a loaded sim file exports, by the name it exports each under. A sim file exports whatever
// its author wrote, so each export is checked before it is called.
//
export type SimExports = Record<string, unknown>;

//
// The factories, by the key of the type each returns, each list in the order it was given.
//
export function factoriesByKey(factories: readonly FactoryInfo[]): Map<string, FactoryInfo[]> {
    const byKey = new Map<string, FactoryInfo[]>();
    for (const factory of factories) {
        const held = byKey.get(factory.key);
        if (!held) {
            byKey.set(factory.key, [factory]);
            continue;
        }
        held.push(factory);
    }
    assert(byKey.size <= factories.length);
    assert.equal([...byKey.values()].reduce((total, held) => total + held.length, 0), factories.length);
    return byKey;
}

//
// Builds the table of factories from what discovery read out of the sim files (in the order the sim
// files are used: the one beside the source, then every `global.sim.ts`) and the sim files as they
// were loaded, by the path discovery printed for each.
//
export function createFactoryTable(factories: readonly FactoryInfo[], loaded: ReadonlyMap<string, SimExports>): IFactoryTable {
    const byKey = factoriesByKey(factories);
    assert(byKey.size <= factories.length);
    const table: IFactoryTable = {
        count: (key) => countFactoryValues(byKey, key),
        make: (key, index, parameters) => makeFactoryValue(byKey, loaded, key, index, parameters),
    };
    assert([...byKey.keys()].every((key) => key.length > 0), "A value factory returns a type with no key.");
    return table;
}

//
// How many values the factories returning the type with `key` offer.
//
export function countFactoryValues(byKey: ReadonlyMap<string, readonly FactoryInfo[]>, key: string): number {
    assert(key.length > 0);
    const count = factoryValues(byKey.get(key) ?? []).length;
    assert(Number.isInteger(count));
    assert(count >= 0);
    return count;
}

//
// Builds the value at `index` among those the factories returning the type with `key` offer. A
// factory that is not there or cannot be called is a mistake in discovery or in loading, so it
// crashes.
//
export function makeFactoryValue(byKey: ReadonlyMap<string, readonly FactoryInfo[]>, loaded: ReadonlyMap<string, SimExports>, key: string, index: number, parameters: IParameterBuilder): unknown {
    const held = byKey.get(key);
    assert.ok(held !== undefined, `No value factory returns the type ${key}.`);
    const value = factoryValues(held)[index];
    assert.ok(value, `There is no value factory value ${index} for the type ${key}.`);
    const factory = value.factory;
    const simExports = loaded.get(factory.file);
    assert.ok(simExports !== undefined, `The sim file ${factory.file} was not loaded.`);
    const exported = simExports[factory.exportName];
    assert.ok(typeof exported === "function", `${factory.file} exports no function ${factory.exportName}.`);
    if (!factory.method) {
        assert.equal(value.calls, 1);
        const values = factory.parameters.map((parameter) => parameters.build(parameter));
        return Reflect.apply(exported, undefined, values);
    }
    assert(value.calls <= seriesLength);
    const instance = buildInstance(factory, exported, parameters);
    const method: unknown = Reflect.get(instance, factory.method);
    assert.ok(typeof method === "function", `${factory.exportName} has no method ${factory.method}.`);
    //
    // The calls before the last move the sequence on. The last call's value is the one asked for.
    //
    for (let call = 1; call < value.calls; call += 1) {
        Reflect.apply(method, instance, factory.parameters.map((parameter) => parameters.build(parameter)));
    }
    return Reflect.apply(method, instance, factory.parameters.map((parameter) => parameters.build(parameter)));
}

//
// Every value the factories `held` offer, in order: each function once and each method of a
// factory class called once, twice and so on up to `seriesLength` times.
//
export function factoryValues(held: readonly FactoryInfo[]): IFactoryValue[] {
    const values: IFactoryValue[] = [];
    for (const factory of held) {
        const longest = factory.method ? seriesLength : 1;
        for (let calls = 1; calls <= longest; calls += 1) {
            values.push({
                factory,
                calls,
            });
        }
    }
    assert.ok(values.length >= held.length);
    assert.ok(values.length <= held.length * seriesLength);
    return values;
}

//
// A new instance of a factory's class, built with its constructor's arguments.
//
export function buildInstance(factory: FactoryInfo, owner: Function, parameters: IParameterBuilder): object {
    assert.ok(factory.method, `${factory.exportName} is a function, not a class with a method.`);
    const ownerArguments = (factory.ownerParameters ?? []).map((parameter) => parameters.build(parameter));
    const built: unknown = Reflect.construct(owner, ownerArguments);
    assert.ok(typeof built === "object");
    assert.ok(built !== null);
    return built;
}
