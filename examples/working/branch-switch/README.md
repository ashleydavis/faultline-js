# Every arm of a switch

One code path per arm, the `default` included. An arm with no statement of its own falls through to the next, so the next arm's code path says either ran. Each member of the union of literals is a boundary value, so every arm is reached.
