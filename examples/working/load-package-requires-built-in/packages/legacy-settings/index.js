//
// Reads a setting from a file, as an older package written as CommonJS does.
//
const fs = require("fs");

//
// The text of the settings file at `file`, or null when there is none.
//
exports.readSettings = function readSettings(file) {
    if (!fs.existsSync(file)) {
        return null;
    }
    return fs.readFileSync(file, "utf8");
};
