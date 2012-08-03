#!/bin/sh
node test-memory-leaks.js && \
node test-agent.js && \
node test-framer.js && \
node test-scrubber.js 
