# A symlink in the simulated filesystem

`follow` makes a symlink and reads through it. The filesystem Faultline gives a call is held in memory and has symlinks, so the link is made and followed without touching the disk. The target is not there, so the link leads nowhere and the call reaches the code path for that. The scenario in `links.sim.ts` writes the target first, so the code path for a link that leads to a file is reached too. Faultline also injects each way making a link can fail.
