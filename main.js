import "https://deno.land/std/dotenv/load.ts";
import { serve } from "https://deno.land/std/http/server.ts";
import { router } from "https://deno.land/x/rutt/mod.ts";
import { encode } from "https://deno.land/std/encoding/hex.ts";
import { generateComment } from "./generate_comment.js";

const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
const equinixProjectId = Deno.env.get("EQUINIX_PROJECT_ID");
const equinixToken = Deno.env.get("EQUINIX_TOKEN");
const githubToken = Deno.env.get("GITHUB_TOKEN");

async function createSpotMarketRequest(prNumber) {
  const resp = await fetch(
    `https://api.equinix.com/metal/v1/projects/${equinixProjectId}/spot-market-requests`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": equinixToken,
      },
      body: JSON.stringify({
        "devices_max": 1,
        "devices_min": 1,
        "max_bid_price": 0.2,
        "instance_parameters": {
          "hostname": "divy2",
          "plan": "m3.small.x86",
          "operating_system": "ubuntu_22_04",
          "userdata": createBenchScript(prNumber),
          // "metro": "fr",
        },
      }),
    },
  );
  return resp.json();
}

function createBenchScript(prNumber) {
  return `#!/bin/bash
apt-get install -y unzip git
export PATH=$HOME/.deno/bin:$PATH
git clone --depth=1 --recurse-submodules https://github.com/littledivy/equinix-metal-test
sh equinix-metal-test/install_deno.sh
GITHUB_TOKEN=${githubToken} deno run -A --unstable equinix-metal-test/generate_comment.js littledivy/equinix-metal-test ${prNumber} 
`;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

const key = await crypto.subtle.importKey(
  "raw",
  enc.encode(webhookSecret),
  { name: "HMAC", hash: "SHA-1" },
  false,
  ["verify", "sign"],
);

async function sign(data) {
  const s = await crypto.subtle.sign("HMAC", key, new Uint8Array(data));
  return `sha1=${dec.decode(encode(new Uint8Array(s)))}`;
}

const authorizedRoles = ["OWNER", "MEMBER"];

async function handler(req) {
  const event = req.headers.get("x-github-event");
  if (!event) return new Response("No event", { status: 400 });

  const signature = req.headers.get("x-hub-signature");
  const body = await req.arrayBuffer();
  const digest = await sign(body);
  if (signature !== digest) {
    return new Response("Invalid signature", { status: 401 });
  }

  const fn = ({
    "ping": () => {},
    "issue_comment": async (event) => {
      if (event.action === "created") {
        const id = event.issue.number;
        const comment = event.comment.body.trim();
        const authorized = authorizedRoles.includes(
          event.comment.author_association,
        );
        if (
          authorized &&
          comment == "+bench"
        ) {
          console.log("Creating spot market request");
          const request = await createSpotMarketRequest(id);
          if (request.errors) {
            await generateComment(`❌ ${request.errors[0]}`, id);
            return;
          }
          console.log(req)
          await generateComment(
            `⏳ Provisioning metal.\n\n id: \`${request.id}\`\n metro: \`${
              request.metro ?? "unknown"
            }\`\n\n<sup><sub> Use \`+bench status\` for status </sup></sub>`,
            id,
          );
        }

        if (
          authorized &&
          comment == "+bench status"
        ) {
          // TODO
        }
      }
    },
  })[event];

  if (!fn) return new Response("No handler for event", { status: 400 });
  const info = JSON.parse(dec.decode(body));
  await fn(info);
  return new Response("OK");
}

serve(router({
  "/hooks/github": handler,
}));
