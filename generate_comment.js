import "https://deno.land/std/dotenv/load.ts";

const repo = Deno.args[0] || "denoland/deno";
const pullNumber = Deno.args[1];
const artifactID = Deno.args[2];
const artifactName = `deno-${pullNumber}`;

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

async function downloadArtifact() {
  const redirected = await fetch(
    `https://api.github.com/repos/denoland/deno/actions/artifacts/${artifactID}/zip`,
    {
      headers: {
        "Authorization": `token ${token}`,
      },
    },
  );
  const location = redirected.url;
  // curl
  const result = await Deno.run({
    cmd: [
      "curl",
      "-L",
      "-H",
      `Authorization: token ${token}`,
      "-o",
      "artifact.zip",
      location,
    ],
  });
  await result.status();
  result.close();
  // unzip
  const unzip = await Deno.run({
    cmd: ["unzip", "artifact.zip"],
  });
  await unzip.status();
  unzip.close();
  // chmod
  const chmod = await Deno.run({
    cmd: ["chmod", "+x", "./deno"],
  });
  await chmod.status();
  chmod.close();
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
    `https://api.equinix.com/metal/v1/devices/${id}?force_delete=true`,
    {
      method: "DELETE",
      headers: {
        "X-Auth-Token": equinixToken,
      },
    },
  );
  return resp.text();
}

async function runHyperfine() {
  const result = await Deno.run({
    cmd: [
      hyperfine,
      "--warmup",
      "5",
      "--show-output",
      "--export-markdown",
      "benchmark.md",
      "deno run equinix-metal-test/nop.js",
      `./deno run equinix-metal-test/nop.js`,
    ],
  });
  await result.status();
}

if (import.meta.main) {
  try {
    await downloadArtifact();
    await runHyperfine();
    const body = await Deno.readTextFile("benchmark.md");
    console.log(await generateComment(body, pullNumber));
  } finally {
    console.log(await terminateInstance());
  }
}
