import "https://deno.land/std/dotenv/load.ts";
import { serve } from "https://deno.land/std/http/server.ts";
import { router } from "https://deno.land/x/rutt/mod.ts";
import { encode } from "https://deno.land/std/encoding/hex.ts";
import { generateComment } from "./generate_comment.js";

const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
const equinixProjectId = Deno.env.get("EQUINIX_PROJECT_ID");
const equinixToken = Deno.env.get("EQUINIX_TOKEN");
const githubToken = Deno.env.get("GITHUB_TOKEN");

async function createSpotMarketRequest(prNumber, type_) {
  const artifactId = await getArtifactId(prNumber);
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
          "userdata": createBenchScript(prNumber, artifactId, type_),
        },
      }),
    },
  );
  return resp.json();
}

async function getSpotMarketRequest(id) {
  const resp = await fetch(
    `https://api.equinix.com/metal/v1/projects/${equinixProjectId}/spot-market-requests`,
    {
      headers: {
        "X-Auth-Token": equinixToken,
      },
    },
  );
  const result = await resp.json();
  return result.spot_market_requests.find((r) => r.id === id);
}

async function getArtifactId(prNumber) {
  const artifactName = `deno-${prNumber}`;
  const resp = await fetch(
    `https://api.github.com/repos/denoland/deno/actions/artifacts?per_page=100`,
    {
      headers: {
        "Authorization": `token ${githubToken}`,
      },
    },
  );
  const result = await resp.json();
  const artifact = result.artifacts.find((a) => a.name === artifactName);
  if (!artifact) console.error("CI pending or PR marked as draft");
  return artifact.id;
}

function createBenchScript(prNumber, artifactId, type_) {
  return `#!/bin/bash
apt-get install -y unzip git
export PATH=$HOME/.deno/bin:$PATH
git clone --depth=1 --recurse-submodules https://github.com/littledivy/equinix-metal-test
sh equinix-metal-test/install_deno.sh
deno upgrade --canary
GITHUB_TOKEN=${githubToken} EQUINIX_TOKEN=${equinixToken} deno run -A --unstable equinix-metal-test/generate_comment.js denoland/deno ${prNumber} ${artifactId} ${type_}
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

function benchmarkType(arg) {
  if (!arg) return "hyperfine";
  arg = arg.trim();
  return arg;
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
          comment.startsWith("+bench") &&
          !comment.startsWith("+bench status")
        ) {
          const args = comment.split(" ")[1];
          const type_ = benchmarkType(args);
          console.log("Creating spot market request");
          const request = await createSpotMarketRequest(id, type_);
          if (request.errors) {
            await generateComment(`❌ ${request.errors[0]}`, id);
            return;
          }
          await generateComment(
            `⏳ Provisioning metal...\n\n id: \`${request.id}\`\n metro: \`${
              request.metro ?? "unknown"
            }\`\n\n<sup><sub> Use \`+bench status <id>\` for status </sup></sub>`,
            id,
          );
        }

        if (
          authorized &&
          comment.startsWith("+bench status")
        ) {
          const reqid = comment.split(" ")[2];
          if (!reqid) {
            return;
          }

          const request = await getSpotMarketRequest(reqid.trim());
          if (request.errors || request.error) return;
          const device = request.devices[0];
          if (device) {
            const d = await fetch(`https://api.equinix.com${device.href}`, {
              headers: {
                "X-Auth-Token": equinixToken,
              },
            });
            const res = await d.json();
            let metro = res.metro
              ? `metro: ${res.metro.name} (${res.metro.country})`
              : "unknown";
            const percentage = `${
              Math.round(res.provisioning_percentage || 100)
            }%`;
            await generateComment(
              `✅ Device provisioned ${percentage}\n\n${metro}`,
              id,
            );
          } else {
            await generateComment(
              `⏳ No device provisioned yet\n\ncreated_at: \`${request.created_at}\``,
              id,
            );
          }
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
