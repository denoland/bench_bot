function parseLatency(str1, unit) {
  let latency = parseFloat(str1);
  switch (unit) {
    case "ms":
      latency *= 1000;
      break;
    case "s":
      latency *= 1000000;
      break;
    default:
      break;
  }
  return latency;
}

const rxLatency =
  /Latency\s+([\d\.]+)(\w+)\s+([\d\.]+)(\w+)\s+([\d\.]+)(\w+)\s+([\d\.]+)\%/;
const rxReq = /\s+(\d+) requests in (\d+\.\d+)(\w+), (\d+\.\d+)(\w+) read/;
const rxRPS = /Requests\/sec:\s+([\d\.]+)\s/;
const rxThread = /Thread: (\d), (\d+): (\d+)\s?/;
const rxPercent = /([\d\.]+)\%,(\d+)/;

function parseWrks(text) {
  const result = { latency: {} };
  let rps = 0;
  let match = text.match(rxLatency);
  if (match && match.length > 2) {
    result.latency.average = parseLatency(match[1], match[2]);
    result.latency.stdev = parseLatency(match[3], match[4]);
    result.latency.max = parseLatency(match[5], match[6]);
    result.latency.variance = parseLatency(match[7]);
  }
  match = text.match(rxReq);
  if (match && match.length > 1) {
    const [requests, time, tunit, read, unit] = match.slice(1);
    result.requests = parseInt(requests, 10);
    if (tunit.toLowerCase() === "s") {
      result.time = parseFloat(time);
    } else if (tunit.toLowerCase() === "m") {
      result.time = parseFloat(time) * 60;
    } else {
      result.time = parseFloat(time) * (60 * 60);
    }
    if (unit.toLowerCase() === "mb") {
      result.bytes = parseFloat(read) * 1000000;
    } else if (unit.toLowerCase() === "gb") {
      result.bytes = parseFloat(read) * 1000000000;
    } else {
      result.bytes = parseFloat(read);
    }
  }
  match = text.match(rxRPS);
  if (match && match.length > 1) {
    rps = parseInt(match[1], 10);
  }
  result.rps = rps;
  const lines = text.split("\n");
  const statuses = {};
  const threads = {};
  const percentiles = {};
  for (const line of lines) {
    const parts = line.match(rxThread);
    if (parts && parts.length > 2) {
      const [, id, status, count] = parts;
      threads[id] = threads[id] || {};
      threads[id][status] = count;
      if (statuses[status]) {
        statuses[status] += parseInt(count, 10);
      } else {
        statuses[status] = parseInt(count, 10);
      }
    } else {
      const parts = line.match(rxPercent);
      if (parts && parts.length > 2) {
        const [, percentile, count] = parts;
        percentiles[percentile] = parseInt(count, 10);
      }
    }
  }
  result.percentiles = percentiles;
  result.threads = threads;
  result.statuses = statuses;
  return result;
}
