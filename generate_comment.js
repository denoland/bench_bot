import "https://deno.land/std/dotenv/load.ts";

const repo = Deno.args[0] || "littledivy/equinix-metal-test";
const pullNumber = Deno.args[1] || "1";
const token = Deno.env.get("GITHUB_TOKEN");
const equinixToken = Deno.env.get("EQUINIX_TOKEN");

const osDir = Deno.build.os === "linux" ? "linux64" : "mac";
const hyperfine = `equinix-metal-test/third_party/prebuilt/${osDir}/hyperfine`;

export async function generateComment(body, pullNumber) {
  const comment = {
    body,
  };
  const response = await fetch(
    `https://api.github.com/repos/${repo}/issues/${pullNumber}/comments`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `token ${token}`,
      },
      body: JSON.stringify(comment),
    },
  );
  return response.json();
}

async function getInstanceMetadata() {
  const resp = await fetch(
    `https://metadata.platformequinix.com/metadata`,
  );
  return resp.json();
}

async function terminateInstance() {
  const { id } = await getInstanceMetadata();
  const resp = await fetch(
    `https://api.equinix.com/metal/v1/devices/${id}`,
    {
      method: "DELETE",
      headers: {
        "X-Auth-Token": equinixToken,
      },
    },
  );
  return resp.json();
}

async function runHyperfine() {
  const result = await Deno.run({
    cmd: [
      hyperfine,
      "--show-output",
      "--export-markdown",
      "benchmark.md",
      "deno run --allow-net --allow-env equinix-metal-test/nop.js",
      // "node nop.js",
    ],
  });
  await result.status();
}

if (import.meta.main) {
  try {
    await runHyperfine();
    const body = await Deno.readTextFile("benchmark.md");
    console.log(await generateComment(body, pullNumber));
  } finally {
    console.log(await terminateInstance());
  }
}
