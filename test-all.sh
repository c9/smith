#!/bin/sh
echo "\nChecking message deframer..." && \
node tests/test-framer.js && \
echo "\nChecking message scrubber..." && \
node tests/test-scrubber.js && \
echo "\nChecking Agent interface..." && \
node tests/test-agent.js && \
echo "\nChecking for memory leaks..." && \
node tests/test-memory-leaks.js
