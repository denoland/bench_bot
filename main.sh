#!/bin/bash

apt-get install unzip git
curl -fsSL https://deno.land/install.sh | sh

git clone --depth=1 --recurse-submodules https://github.com/littledivy/equinix-metal-test

~/.deno/bin/deno run -A --unstable equinix-metal-test/generate_comment.js
