# A top level that never finishes

A file whose top level loops for ever, so loading it never finishes. Faultline stops opening the file when its limit on opening a file passes, reports the file's top level as a call that never returned and opens the file only that once.
