# A private function and a callback

A function the file does not export is a function of its own in the report, and Faultline calls it directly. A callback written inside another function is not: its code paths belong to the function that wrote it.
