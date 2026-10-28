//
// How Jest finds, compiles and measures the unit tests. It is kept in a file of its own rather than
// in `package.json`, so it can say beside each setting why it is set.
//

export default {
    //
    // The tests and the source are TypeScript, and ts-jest compiles them with the project's own
    // `tsconfig.json`, so a test reads the types the build does.
    //
    preset: "ts-jest",

    //
    // Faultline runs on Node, so the tests run in Node rather than in a browser stand-in.
    //
    testEnvironment: "node",

    //
    // The build writes a copy of every module and test to `dist/`, and Jest would otherwise find
    // two modules of the same name.
    //
    modulePathIgnorePatterns: [
        "dist",
    ],

    //
    // ts-jest writes a relative import of `./name.ts` as `./name.js`, as the build does, and Jest
    // has to find the TypeScript file it came from.
    //
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },

    //
    // Each test sits beside its source, named after it.
    //
    testMatch: [
        "**/src/**/*.test.ts",
    ],

    //
    // The fixture shared by the discover tests and the file system in memory shared by every test
    // hold no test of their own. `tmp/` holds the projects the smoke checks write and any other
    // scratch project, whose tests are that project's and not Faultline's.
    //
    testPathIgnorePatterns: [
        "/node_modules/",
        "/dist/",
        "<rootDir>/tmp/",
        "/src/discover/fixture\\.test\\.ts$",
        "/src/lib/fake-files\\.test\\.ts$",
    ],

    //
    // Coverage counts every source file, so a file no test loads shows as uncovered rather than
    // going unseen. Declarations and tests hold no code of their own to count.
    //
    collectCoverageFrom: [
        "src/**/*.ts",
        "!src/**/*.d.ts",
        "!src/**/*.test.ts",

        //
        // `flt` runs itself when it is imported and reads `import.meta`, which Jest's CommonJS
        // cannot load. It only hands over to `src/main.ts`, which Jest measures, and the smoke
        // check `src/smoke/node-refusal.smoke.ts` starts it as a process.
        //
        "!src/bin/flt.ts",

        //
        // The child process's entry sets up the process it runs in (coverage, the replaced globals,
        // the module hooks) and imports project files by URL, which Jest's CommonJS cannot load.
        // `src/run/worker.test.ts` runs it in real child processes, where Jest cannot count what
        // ran; everything it calls is in `src/run/child.ts`, which Jest measures.
        //
        "!src/run/child-main.ts",

        //
        // The reader thread's entry only reads its settings and passes each request to
        // `answerReaderRequest` in `src/run/shard-reader.ts`, which Jest measures. It runs on a
        // worker thread of the child process, which Jest's CommonJS cannot start.
        //
        "!src/run/reader-thread.ts",

        //
        // The smoke checks start processes and read the repository, so `scripts/smoke.sh` runs them
        // with Node and Jest never loads them.
        //
        "!src/smoke/**",
    ],
};
