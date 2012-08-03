#!/bin/sh
node tests/test-memory-leaks.js && \
node tests/test-agent.js && \
node tests/test-framer.js && \
node tests/test-scrubber.js 
