# A value factory written as a class

A value factory written as a method on an exported class gives the next value of a sequence each time it is called. Faultline builds the class anew for each value and calls the method once, twice and three times, so one factory gives several values and each call can be repeated on its own. The units a reading can have are keys of a map, which no condition in the source names, so only the factory reaches them.
