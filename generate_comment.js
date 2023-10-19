import "https://deno.land/std/dotenv/load.ts";

const repo = Deno.args[0] || "denoland/deno";
const pullNumber = Deno.args[1];
const artifactID = Deno.args[2];
const benchmarkType = Deno.args[3];
const artifactName = `deno-${pullNumber}`;

const token = Deno.env.get("GITHUB_TOKEN");
const equinixToken = Deno.env.get("EQUINIX_TOKEN");

const osDir = Deno.build.os === "linux" ? "linux64" : "mac";
const hyperfineBin =
  `equinix-metal-test/third_party/prebuilt/${osDir}/hyperfine`;

export function svgChart(means) {
  const body =
    `![](https://quickchart.io/chart?c={type:%27bar%27,data:{labels:${
      JSON.stringify(Object.keys(means))
    },datasets:[{label:%27Units%27,data:${
      JSON.stringify(Object.values(means))
    }}]}})
  `;
  return body;
}

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
      hyperfineBin,
      "--warmup",
      "5",
      "--show-output",
      "--export-json",
      "hyperfine.json",
      "deno run equinix-metal-test/nop.js",
      `./deno run equinix-metal-test/nop.js`,
    ],
  });
  await result.status();
}

async function hyperfine() {
  await runHyperfine();
  const { results } = JSON.parse(await Deno.readTextFile("hyperfine.json"));
  const means = { "deno-main": results[0].mean, "deno-pr": results[1].mean };
  console.log(await generateComment(svgChart(means), pullNumber));
}

async function wrk() {
  const result = await Deno.run({
    cmd: [
      "wrk",
      "-t",
      2,
      "-d",
      30,
      "-c",
      256,
      `http://127.0.0.1:8080/`,
    ],
  });

  await result.status();
}

const benchmarkTypes = {
  hyperfine,
  wrk,
};

if (import.meta.main) {
  try {
    await downloadArtifact();
    const run = benchmarkTypes[benchmarkType];
    if (run) run();
    else await generateComment(`benchmark type invalid: ${benchmarkType}`);
  } catch (e) {
    await generateComment(e.toString(), pullNumber);
  } finally {
    console.log(await terminateInstance());
  }
}
