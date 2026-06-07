import { expect } from "chai";

import { deploymentStartBlock, eventQueryRanges, MAX_EVENT_QUERY_BLOCKS } from "../shared/eventQuery";

describe("event query ranges", function () {
  it("starts from the deployment block and chunks public RPC log ranges", function () {
    const start = deploymentStartBlock(11_002_561);
    const ranges = eventQueryRanges(start, 11_102_600);

    expect(start).to.equal(11_002_561);
    expect(ranges).to.deep.equal([
      { fromBlock: 11_002_561, toBlock: 11_052_560 },
      { fromBlock: 11_052_561, toBlock: 11_102_560 },
      { fromBlock: 11_102_561, toBlock: 11_102_600 }
    ]);
    for (const range of ranges) {
      expect(range.toBlock - range.fromBlock + 1).to.be.at.most(MAX_EVENT_QUERY_BLOCKS);
    }
  });

  it("falls back to genesis when deploymentBlock is absent for local chains", function () {
    expect(deploymentStartBlock(undefined)).to.equal(0);
    expect(eventQueryRanges(0, 3)).to.deep.equal([{ fromBlock: 0, toBlock: 3 }]);
  });
});
