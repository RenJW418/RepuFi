export const MAX_EVENT_QUERY_BLOCKS = 50_000;

export type EventQueryRange = {
  fromBlock: number;
  toBlock: number;
};

export function deploymentStartBlock(deploymentBlock: number | undefined): number {
  return deploymentBlock ?? 0;
}

export function eventQueryRanges(
  fromBlock: number,
  latestBlock: number,
  maxBlocks = MAX_EVENT_QUERY_BLOCKS
): EventQueryRange[] {
  if (!Number.isSafeInteger(fromBlock) || fromBlock < 0) {
    throw new Error("fromBlock must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(latestBlock) || latestBlock < 0) {
    throw new Error("latestBlock must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks <= 0) {
    throw new Error("maxBlocks must be a positive safe integer.");
  }
  if (fromBlock > latestBlock) {
    return [];
  }

  const ranges: EventQueryRange[] = [];
  for (let start = fromBlock; start <= latestBlock; start += maxBlocks) {
    ranges.push({
      fromBlock: start,
      toBlock: Math.min(start + maxBlocks - 1, latestBlock)
    });
  }
  return ranges;
}
