#!/bin/sh
# Unit tests for the pure logic (no browser, no dependencies): sh tools/unit/run.sh
cd "$(dirname "$0")" && TZ=Europe/Berlin exec node --test ./*.test.mjs
