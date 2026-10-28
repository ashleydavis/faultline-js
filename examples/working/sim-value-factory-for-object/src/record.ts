//
// Counting the fields of a record, whatever its type.
//

//
// Says how many fields the record has, or "empty" for one with none.
//
export function describeFields(record: object): string {
    const count = Object.keys(record).length;
    if (count === 0) {
        return "empty";
    }
    return `${count} fields`;
}
