# A sim file using a type declared for every file

One file adds a type to every file of the project with `declare global`, as a project adds the signed-in user to a web framework's request. Neither the source nor its sim file imports that file. The project's own type check reads every file the `tsconfig.json` names, so the type is there. Faultline reads the files under the `tsconfig.json`'s directory that declare something for every file into each file's program, so the sim file has no type error and its value factory is used.
