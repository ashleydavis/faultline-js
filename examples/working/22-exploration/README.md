# The failure that only happens on the third call

A run draws faults from its seed, which reaches the places the dice land on. That is enough for the first read going wrong and rarely enough for the third.

After the first round, flt drives only the functions with a path left. It calls each one once to see where its effects could fail, then once more for every one of those places and every way that effect goes wrong. Every place is reached rather than the ones the draw happened to hit.
