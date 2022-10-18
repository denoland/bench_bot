apt-get install unzip git
curl -fsSL https://deno.land/install.sh | sh

git clone --depth=1 https://github.com/denoland/deno_third_party
git clone --depth=1 https://github.com/littledivy/equinix-metal-test

~/.deno/bin/deno run -A --unstable equinix-metal-test/generate_comment.js

curl -s -H "Authorization: token your_token_here" \
 -X POST -d @comment.json \ 
 "https://api.github.com/repos/denoland/deno/pulls/{pull_number}/reviews"