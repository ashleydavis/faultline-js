# A file started as the entry point

A code path that runs only when the file is the one `node` started, which `import.meta.main` says. A file Faultline loads is never that file, so a scenario starts it with `context.start`, and `import.meta.main` is true for it.
