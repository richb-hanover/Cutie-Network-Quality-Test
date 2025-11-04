#!/bin/bash

# Create timestamp in format yyyy-mm-dd-hh-mm-ss
timestamp=$(date +"%Y-%m-%d-%H-%M-%S")

# Log file name - save all the log files into the "logs" directory
logfile="logs/cutie-$timestamp.txt"

# Run npm dev with LOG_LEVEL=2 and nohup
nohup env LOG_LEVEL=2 npm run dev > "$logfile" 2>&1 &
