//
// Names an hour of the day in words, the way a package's plugin file does.
//

//
// Gives "morning" before noon and "afternoon" from noon on.
//
export function nameHour(hour) {
    return hour < 12 ? "morning" : "afternoon";
}
