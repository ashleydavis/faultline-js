# A misspelt key in the configuration file

`faultline.config.yaml` names `exlude` where `exclude` was meant. The run refuses the file with a sentence naming the key and the keys it may hold, rather than testing files that were meant to be left out. It exits 1.
